// The HTTP plumbing every real adapter shares (PRV-011): a `fetch` wrapper that takes the
// caller's abort signal and an idle timeout, maps every failure onto a `ProviderError`
// (PRV-013), and reads the body chunk by chunk or as JSON. Adapters build the URL,
// headers, and body, and send the API key themselves; no error made here ever contains
// it (CONV-072).
import { type SecretSchema, type TimeSource, err, ok, type Result } from '@mythos/contracts';
import { z } from 'zod';
import { type DataDirEnv, resolveSecret } from '../../config';
import type { ProviderError } from '../types';
import { cancelledError, headerError, statusError, thrownError, timeoutError } from './http-errors';

/** One request to a provider's HTTP API. */
export type HttpRequest = {
  /** Names the provider in error messages, in plain words: "Ollama". */
  provider: string;
  method: 'GET' | 'POST';
  url: string;
  headers?: Readonly<Record<string, string>>;
  /** Sent as JSON, with `content-type: application/json`. Omit for no body. */
  body?: unknown;
  /** The caller's signal. Aborting it ends the call with `cancelled` (PRV-047). */
  signal: AbortSignal;
  /**
   * The longest wait for the response headers, and then for each chunk of the body. It
   * never bounds the whole call, so a stream that keeps arriving never times out.
   */
  timeoutMs: number;
  /** Values never to show in an error message, such as the API key. */
  secrets?: readonly string[];
};

/** A successful (2xx) response. Read its body once, with `chunks` or `json`. */
export type HttpResponse = {
  readonly status: number;
  readonly headers: Headers;
  /**
   * The body, chunk by chunk, each read under the idle timeout. A failure is yielded as
   * an err and ends the body. Stopping early (`break` or `return`) closes the connection.
   */
  chunks(): AsyncGenerator<Result<Uint8Array, ProviderError>, void, undefined>;
  /** The whole body, parsed as JSON and then with `schema` (see `parseWire`). */
  json<T>(schema: z.ZodType<T>): Promise<Result<T, ProviderError>>;
};

/** The `details` of a `rate_limited` error: the wait `retry-after` asks for, if it said. */
export const RateLimitDetailsSchema = z.object({
  retryAfterSeconds: z.number().nonnegative().nullable(),
});
export type RateLimitDetails = z.infer<typeof RateLimitDetailsSchema>;

/** One call's abort and idle-timeout state, shared by the request and its body. */
type Call = {
  /** Aborts on the caller's abort, on an idle timeout, or on `close`. */
  signal: AbortSignal;
  /** Starts the idle timer, before each wait. */
  arm: () => void;
  /** Stops the idle timer, after each wait. */
  disarm: () => void;
  /** Ends the request, when its reader stops early. */
  close: () => void;
  /** The `ProviderError` for whatever `fetch` or the body threw. */
  failure: (thrown: unknown) => ProviderError;
};

function startCall(request: HttpRequest): Call {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const disarm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    signal: AbortSignal.any([request.signal, controller.signal]),
    arm: () => {
      disarm();
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, request.timeoutMs);
    },
    disarm,
    close: () => {
      disarm();
      controller.abort();
    },
    failure: (thrown) => {
      // The caller's abort comes first: a call cancelled as it timed out was cancelled.
      if (request.signal.aborted) return cancelledError(request);
      if (timedOut) return timeoutError(request);
      return thrownError(thrown, request);
    },
  };
}

/**
 * Sends `request` and waits for the response headers. A 2xx status is `ok`, with the body
 * still to read; any other status, a failure to connect, an idle timeout, or the caller's
 * abort is the `ProviderError` PRV-013 gives it. `timeSource` turns an HTTP-date
 * `retry-after` into seconds. Implements PRV-011, PRV-013, and PRV-047.
 */
export async function sendRequest(
  request: HttpRequest,
  timeSource: TimeSource,
): Promise<Result<HttpResponse, ProviderError>> {
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) headers['content-type'] = 'application/json';
  const unsendable = headerError(headers, request);
  if (unsendable !== null) return err(unsendable);

  const call = startCall(request);
  call.arm();
  const sent = await fetch(request.url, {
    method: request.method,
    headers,
    body: request.body === undefined ? null : JSON.stringify(request.body),
    signal: call.signal,
  }).then(ok, (thrown: unknown) => err(thrown));
  call.disarm();
  if (!sent.ok) return err(call.failure(sent.error));

  const response = sent.value;
  const chunks = (): AsyncGenerator<Result<Uint8Array, ProviderError>, void, undefined> =>
    readChunks(response, call);
  if (!response.ok) {
    const bodyText = await readErrorBody(chunks());
    if (request.signal.aborted) return err(cancelledError(request));
    return err(statusError(response, bodyText, request, timeSource));
  }
  return ok({
    status: response.status,
    headers: response.headers,
    chunks,
    json: async <T>(schema: z.ZodType<T>): Promise<Result<T, ProviderError>> => {
      const text = await collectText(chunks());
      return text.ok ? parseWire(text.value, schema, request.provider) : text;
    },
  });
}

async function* readChunks(
  response: Response,
  call: Call,
): AsyncGenerator<Result<Uint8Array, ProviderError>, void, undefined> {
  if (response.body === null) return;
  const reader = response.body.getReader();
  let finished = false;
  try {
    for (;;) {
      call.arm();
      const next = await reader.read().then(ok, (thrown: unknown) => err(thrown));
      call.disarm();
      if (!next.ok) {
        finished = true;
        yield err(call.failure(next.error));
        return;
      }
      if (next.value.done) {
        finished = true;
        return;
      }
      // Node's types leave the chunk as `any`; a fetch body is always bytes.
      const bytes: unknown = next.value.value;
      if (!(bytes instanceof Uint8Array)) {
        throw new Error('fetch gave a body chunk that is not bytes.');
      }
      yield ok(bytes);
    }
  } finally {
    if (!finished) call.close();
  }
}

/** The whole body as text, or the failure that ended it. */
async function collectText(
  chunks: AsyncIterable<Result<Uint8Array, ProviderError>>,
): Promise<Result<string, ProviderError>> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of chunks) {
    if (!chunk.ok) return chunk;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return ok(text + decoder.decode());
}

/** An error response's body is read only for its message, so no more than this. */
const ERROR_BODY_LIMIT = 64 * 1024;

/**
 * An error response's body, for the message in it, up to ERROR_BODY_LIMIT characters. A
 * failure while reading it gives what arrived: the status already says what went wrong.
 */
async function readErrorBody(
  chunks: AsyncIterable<Result<Uint8Array, ProviderError>>,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of chunks) {
    if (!chunk.ok || text.length >= ERROR_BODY_LIMIT) break;
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text;
}

/**
 * Parses a response body, or one line or event of a stream, as JSON and then with the
 * adapter's wire schema. Text that is not JSON, or does not match, is
 * `provider_unavailable`: the provider sent something Mythos cannot read. Implements
 * PRV-012 and CONV-030.
 */
export function parseWire<T>(
  text: string,
  schema: z.ZodType<T>,
  provider: string,
): Result<T, ProviderError> {
  const json = parseJson(text);
  if (!json.ok) return err(unreadable(provider, 'it is not JSON'));
  const parsed = schema.safeParse(json.value);
  if (parsed.success) return ok(parsed.data);
  const issue = parsed.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `;
  return err(unreadable(provider, `${where}${issue?.message ?? 'it has the wrong shape'}`));
}

function parseJson(text: string): Result<unknown, null> {
  try {
    return ok(JSON.parse(text));
  } catch {
    // Not swallowed: the caller turns the err into a ProviderError (CONV-043).
    return err(null);
  }
}

function unreadable(provider: string, reason: string): ProviderError {
  return {
    code: 'provider_unavailable',
    message: `${provider} sent a response Mythos could not read (${reason}).`,
    retryable: true,
    httpStatus: null,
  };
}

/**
 * The API key from a provider's `apiKey`, without surrounding whitespace, which a `.env`
 * file with Windows line endings can leave. A missing environment variable is
 * `provider_rejected`, not retryable, with `resolveSecret`'s message, which names the
 * variable. Implements PRV-005 and PRV-013.
 */
export function resolveApiKey(
  secret: z.infer<typeof SecretSchema>,
  env: DataDirEnv,
): Result<string, ProviderError> {
  const resolved = resolveSecret(secret, env);
  if (resolved.ok) return ok(resolved.value.trim());
  return err({
    code: 'provider_rejected',
    message: resolved.error.message,
    retryable: false,
    httpStatus: null,
  });
}
