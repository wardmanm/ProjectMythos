// The Ollama adapter. It uses Ollama's native chat API, not its OpenAI-compatible one,
// because only the native API sets the context size, keep-alive, and thinking per request
// (PRV-020 to PRV-022). A streamed reply is newline-delimited JSON. The providers README
// links the API documentation this follows.
import { err, ok, type ProviderConfig, type Result } from '@mythos/contracts';
import { z } from 'zod';
import type { AdapterDependencies } from '../registry';
import type { ProviderAdapter, ProviderError, TextRequest, TextResponse } from '../types';
import { type HttpResponse, parseWire, sendRequest } from './http';
import { streamError } from './http-errors';
import { readNdjsonLines } from './lines';
import { getJson, measureHealth } from './quick-calls';
import { createTextOutput, failedCall, type TextOutput, textResponse } from './text-output';

/** A provider config whose `type` is `ollama`. */
export type OllamaProviderConfig = Extract<ProviderConfig, { type: 'ollama' }>;

const PROVIDER = 'Ollama';

/**
 * One line of a streamed `/api/chat` reply, or the whole reply when not streamed. The
 * last line has `done: true` and the counts. An `error` line reports a failure after the
 * 200 status was sent. A tool call's `arguments` is an object, not a string.
 */
const ChatChunkSchema = z.object({
  message: z
    .object({
      content: z.string().optional(),
      thinking: z.string().optional(),
      tool_calls: z
        .array(z.object({ function: z.object({ arguments: z.record(z.string(), z.unknown()) }) }))
        .optional(),
    })
    .optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  /** The whole prompt, the cached part included. */
  prompt_eval_count: z.int().nonnegative().optional(),
  prompt_eval_cached_count: z.int().nonnegative().optional(),
  eval_count: z.int().nonnegative().optional(),
  error: z.string().optional(),
});
type ChatChunk = z.infer<typeof ChatChunkSchema>;

const TagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });
const VersionSchema = z.object({ version: z.string() });

/** The `/api/chat` request body, as Ollama names its fields. */
type ChatBody = {
  model: string;
  messages: { role: string; content: string }[];
  stream: boolean;
  keep_alive: string;
  think?: boolean;
  format?: Record<string, unknown>;
  tools?: { type: 'function'; function: { name: string; parameters: Record<string, unknown> } }[];
  /** Unset sampling values are undefined, which JSON leaves out. */
  options: {
    num_ctx: number;
    num_predict: number;
    temperature: number | undefined;
    top_p: number | undefined;
    top_k: number | undefined;
    repeat_penalty: number | undefined;
    presence_penalty: number | undefined;
  };
};

/**
 * The `/api/chat` body for `req`: the context size from the profile (PRV-020), keep-alive
 * from the provider (PRV-021), `think` from the profile, left out for
 * `provider-default` (PRV-022), and the profile's structured-output method for a JSON
 * format: `json-schema` sets `format` (PRV-023), `tool-call` offers one tool, and
 * `prompt-only` sends nothing. It streams whenever the call has `onDelta`.
 */
export function chatBody(req: TextRequest, config: OllamaProviderConfig): ChatBody {
  const { profile, sampling, format } = req;
  const body: ChatBody = {
    model: profile.model,
    messages: req.messages.map(({ role, content }) => ({ role, content })),
    stream: req.onDelta !== undefined,
    keep_alive: config.keepAlive,
    options: {
      num_ctx: profile.contextWindow,
      num_predict: req.maxOutputTokens,
      temperature: sampling.temperature,
      top_p: sampling.topP,
      top_k: sampling.topK,
      repeat_penalty: sampling.repeatPenalty,
      presence_penalty: sampling.presencePenalty,
    },
  };
  if (profile.thinking !== 'provider-default') body.think = profile.thinking === 'on';
  if (format.type === 'json' && profile.structuredOutput === 'json-schema') {
    body.format = format.jsonSchema;
  }
  if (format.type === 'json' && profile.structuredOutput === 'tool-call') {
    body.tools = [
      { type: 'function', function: { name: format.schemaName, parameters: format.jsonSchema } },
    ];
  }
  return body;
}

/**
 * Builds the adapter for one Ollama server. Implements PRV-010 to PRV-013, PRV-020 to
 * PRV-023, PRV-045 to PRV-047, and PRV-091.
 */
export function createOllamaAdapter(
  config: OllamaProviderConfig,
  deps: AdapterDependencies,
): ProviderAdapter {
  const base = config.baseUrl.replace(/\/+$/, '');
  const quick = (path: string, signal: AbortSignal) => ({
    provider: PROVIDER,
    url: `${base}${path}`,
    signal,
  });

  async function generate(req: TextRequest): Promise<Result<TextResponse, ProviderError>> {
    const sent = await sendRequest(
      {
        provider: PROVIDER,
        method: 'POST',
        url: `${base}/api/chat`,
        body: chatBody(req, config),
        signal: req.signal,
        timeoutMs: req.profile.timeoutMs,
      },
      deps.timeSource,
    );
    if (!sent.ok) return sent;
    return req.onDelta === undefined ? readWhole(sent.value, req) : readStream(sent.value, req);
  }

  return {
    config,
    health: (signal) =>
      measureHealth(deps.timeSource, async () => {
        const body = await getJson(quick('/api/version', signal), VersionSchema, deps.timeSource);
        const origin = new URL(base).origin;
        return body.ok ? ok(`Ollama ${body.value.version} is running at ${origin}.`) : body;
      }),
    listModels: async (signal) => {
      const body = await getJson(quick('/api/tags', signal), TagsSchema, deps.timeSource);
      return body.ok ? ok(body.value.models.map((model) => model.name)) : body;
    },
    text: { generate },
  };
}

async function readWhole(
  response: HttpResponse,
  req: TextRequest,
): Promise<Result<TextResponse, ProviderError>> {
  const body = await response.json(ChatChunkSchema);
  if (!body.ok) return body;
  if (body.value.error !== undefined) {
    return err(streamError(PROVIDER, JSON.stringify(body.value), []));
  }
  const output = createTextOutput(undefined);
  apply(output, body.value);
  return ok(finish(req, output, body.value));
}

/** Reads a streamed reply line by line, passing answer text to `onDelta` as it comes. */
async function readStream(
  response: HttpResponse,
  req: TextRequest,
): Promise<Result<TextResponse, ProviderError>> {
  const output = createTextOutput(req.onDelta);
  let last: ChatChunk | null = null;
  for await (const line of readNdjsonLines(response.chunks())) {
    if (!line.ok) return failedCall(line.error, req, output);
    const chunk = parseWire(line.value, ChatChunkSchema, PROVIDER);
    if (!chunk.ok) return chunk;
    if (chunk.value.error !== undefined) return err(streamError(PROVIDER, line.value, []));
    apply(output, chunk.value);
    if (chunk.value.done === true) last = chunk.value;
  }
  return ok(finish(req, output, last));
}

/**
 * Adds one chunk's thinking, content, and first tool call. With the `tool-call` method,
 * the tool's arguments are the answer; a model that answers in plain text instead has
 * its text used.
 */
function apply(output: TextOutput, chunk: ChatChunk): void {
  const message = chunk.message;
  if (message === undefined) return;
  if (message.thinking !== undefined) output.addThinking(message.thinking);
  if (message.content !== undefined) output.addContent(message.content);
  const call = message.tool_calls?.[0];
  if (call !== undefined && !output.hasToolCall()) {
    output.addToolArguments(JSON.stringify(call.function.arguments));
  }
}

/**
 * The response once the reply has ended. `last` is the `done` chunk with the counts, or
 * null if the body ended without one; counts it lacks are estimated.
 */
function finish(req: TextRequest, output: TextOutput, last: ChatChunk | null): TextResponse {
  output.end();
  return textResponse(req, output, last?.done_reason === 'length' ? 'length' : 'stop', {
    inputTokens: last?.prompt_eval_count ?? null,
    outputTokens: last?.eval_count ?? null,
    cachedInputTokens: last?.prompt_eval_cached_count ?? null,
  });
}
