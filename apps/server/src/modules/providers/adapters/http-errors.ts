// How http.ts turns each way an HTTP call can fail into the `ProviderError` PRV-013 gives
// it, with a message in plain words. Messages name the provider and the server's origin,
// never a header, a path, or a query string, so an API key never reaches one (CONV-072).
import type { TimeSource } from '@mythos/contracts';
import { z } from 'zod';
import type { ProviderError } from '../types';

/** What these messages need to know about the request. */
type Where = { provider: string; url: string; timeoutMs: number; secrets?: readonly string[] };

/** The caller aborted the call (PRV-047). */
export function cancelledError(where: Where): ProviderError {
  return {
    code: 'cancelled',
    message: `The call to ${where.provider} was cancelled.`,
    retryable: false,
    httpStatus: null,
  };
}

/** Nothing arrived for `timeoutMs`: no headers, or no next chunk of the body. */
export function timeoutError(where: Where): ProviderError {
  return {
    code: 'provider_timeout',
    message:
      `${where.provider} at ${originOf(where.url)} sent nothing for ` +
      `${duration(where.timeoutMs)}, so the call timed out.`,
    retryable: true,
    httpStatus: null,
  };
}

/**
 * What `fetch`, or reading the body, threw. Node's `fetch` rejects a network failure with
 * a `TypeError` whose `cause` carries the code. Anything else is unexpected and thrown
 * again (CONV-041).
 */
export function thrownError(thrown: unknown, where: Where): ProviderError {
  if (thrown instanceof TypeError && thrown.cause !== undefined) {
    return transportError(thrown.cause, where);
  }
  throw thrown;
}

/** A header name `fetch` accepts: an HTTP token. */
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** The whitespace `fetch` trims from both ends of a header value. */
const HEADER_WHITESPACE = /^[\t\n\r ]+|[\t\n\r ]+$/g;
/** What `fetch` refuses inside a header value: NUL, a line break, or a non-Latin-1 character. */
const BAD_HEADER_VALUE = /[\0\r\n\u0100-\uffff]/;

/**
 * The error for a header `fetch` would refuse to send, such as an API key with a line
 * break inside it, or null if every header is fine. `fetch`'s own error quotes the value,
 * which may be the API key, so this one names only the header. Implements PRV-013.
 */
export function headerError(
  headers: Readonly<Record<string, string>>,
  where: Where,
): ProviderError | null {
  const bad = Object.entries(headers).find(
    ([name, value]) =>
      !HEADER_NAME.test(name) || BAD_HEADER_VALUE.test(value.replace(HEADER_WHITESPACE, '')),
  );
  if (bad === undefined) return null;
  return {
    code: 'provider_rejected',
    message:
      `Mythos could not send the request to ${where.provider}: its ${bad[0]} header is not ` +
      'valid. Check the API key and headers in Settings.',
    retryable: false,
    httpStatus: null,
  };
}

const ErrorCodeSchema = z.object({ code: z.string() });

/**
 * A network failure, from the `code` on the error `fetch` gives as its cause: a refused
 * connection, an unknown host, a dropped connection, or a connect timeout is
 * `provider_unavailable`; Node's own header and body timeouts are `provider_timeout`.
 * Implements PRV-013.
 */
export function transportError(cause: unknown, where: Where): ProviderError {
  const parsed = ErrorCodeSchema.safeParse(cause);
  const code = parsed.success ? parsed.data.code : null;
  const { provider } = where;
  const origin = originOf(where.url);
  const unavailable = (message: string): ProviderError => ({
    code: 'provider_unavailable',
    message,
    retryable: true,
    httpStatus: null,
  });
  switch (code) {
    case 'ECONNREFUSED':
      return unavailable(
        `Could not connect to ${provider} at ${origin}: the connection was refused. ` +
          'Check that it is running and that the address is right.',
      );
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return unavailable(
        `Could not connect to ${provider}: the address ${origin} could not be found. ` +
          'Check it in Settings.',
      );
    case 'ECONNRESET':
    case 'EPIPE':
    case 'UND_ERR_SOCKET':
      return unavailable(`The connection to ${provider} at ${origin} closed unexpectedly.`);
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return unavailable(
        `Could not connect to ${provider} at ${origin}: the connection timed out.`,
      );
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return {
        code: 'provider_timeout',
        message: `${provider} at ${origin} stopped responding, so the call timed out.`,
        retryable: true,
        httpStatus: null,
      };
    default:
      return unavailable(`Could not reach ${provider} at ${origin} (${code ?? 'network error'}).`);
  }
}

/**
 * The error for a response whose status is not 2xx: 429 is `rate_limited`, with
 * `details.retryAfterSeconds`; 5xx is `provider_unavailable`; any other is
 * `provider_rejected`, not retryable. Each message quotes the provider's own, from
 * `body`. Implements PRV-013.
 */
export function statusError(
  response: { status: number; headers: Headers },
  body: string,
  where: Where,
  timeSource: TimeSource,
): ProviderError {
  const { status } = response;
  const said = providerMessage(body, where.secrets ?? []);
  const quoted = said === null ? '.' : `: ${said}`;
  if (status === 429) {
    const retryAfterSeconds = parseRetryAfter(response.headers.get('retry-after'), timeSource);
    const wait =
      retryAfterSeconds === null ? '' : ` It asks to wait ${String(retryAfterSeconds)} seconds.`;
    return {
      code: 'rate_limited',
      message: `${where.provider} is limiting requests (HTTP 429)${quoted}${wait}`,
      retryable: true,
      httpStatus: status,
      details: { retryAfterSeconds },
    };
  }
  if (status >= 500) {
    return {
      code: 'provider_unavailable',
      message: `${where.provider} had a server error (HTTP ${String(status)})${quoted}`,
      retryable: true,
      httpStatus: status,
    };
  }
  return {
    code: 'provider_rejected',
    message: `${where.provider} rejected the request (HTTP ${String(status)})${quoted}`,
    retryable: false,
    httpStatus: status,
  };
}

/**
 * An error the provider reported inside a 200 response, such as an `error` line in an
 * Ollama stream or an `error` event in an SSE stream: `provider_unavailable`, retryable,
 * since the status could no longer say it. `body` is the line or event's data, which
 * holds the provider's message. Implements PRV-013.
 */
export function streamError(
  provider: string,
  body: string,
  secrets: readonly string[],
): ProviderError {
  const said = providerMessage(body, secrets);
  return {
    code: 'provider_unavailable',
    message: `${provider} stopped with an error${said === null ? '.' : `: ${said}`}`,
    retryable: true,
    httpStatus: null,
  };
}

/**
 * Seconds to wait from a `retry-after` header: a number of seconds, or an HTTP date
 * measured from `timeSource`, never below 0. Null when absent or unreadable.
 */
export function parseRetryAfter(value: string | null, timeSource: TimeSource): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed));
  // An HTTP date names its weekday and month; without letters, Date.parse would read
  // text such as "-5" as some date in 2001.
  if (!/[a-z]/i.test(trimmed)) return null;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - timeSource.now()) / 1000));
}

/**
 * Where providers put the message in an error body: Ollama's `{ error: "…" }`, OpenAI's
 * and Anthropic's `{ error: { message: "…" } }`, a plain `{ message }`, or FastAPI's
 * `{ detail }` (vLLM). A field of another shape is ignored.
 */
const ErrorBodySchema = z.object({
  error: z
    .union([z.string(), z.object({ message: z.string() })])
    .optional()
    .catch(undefined),
  message: z.string().optional().catch(undefined),
  detail: z.string().optional().catch(undefined),
});

/** The longest provider message quoted in an error. */
const MESSAGE_LIMIT = 300;

/**
 * The provider's own message from an error body, on one line and shortened, with every
 * secret replaced; the body itself if it is plain text; null if it is empty or HTML.
 */
export function providerMessage(body: string, secrets: readonly string[]): string | null {
  const parsed = ErrorBodySchema.safeParse(parseJsonOrNull(body));
  const fields = parsed.success ? parsed.data : null;
  const fromJson =
    typeof fields?.error === 'string'
      ? fields.error
      : (fields?.error?.message ?? fields?.message ?? fields?.detail);
  const raw = fromJson ?? (body.trimStart().startsWith('<') ? '' : body);
  let message = raw.replace(/\s+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret !== '') message = message.split(secret).join('[redacted]');
  }
  if (message === '') return null;
  return message.length > MESSAGE_LIMIT ? `${message.slice(0, MESSAGE_LIMIT)}…` : message;
}

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the body is then read as plain text (CONV-043).
    return null;
  }
}

/** The server's scheme, host, and port, without any user name, password, path, or query. */
function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : 'its configured address';
}

function duration(ms: number): string {
  return ms < 1000 ? `${String(ms)} ms` : `${String(ms / 1000)} seconds`;
}
