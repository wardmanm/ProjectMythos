// The OpenAI-compatible adapter: Chat Completions, as LM Studio, llama.cpp's server, vLLM,
// OpenRouter, and others serve it (PRV-030). A streamed reply is server-sent events ending
// in `[DONE]`. The API key is optional, since local servers need none, and is sent as a
// bearer token when configured.
import { err, ok, type ProviderConfig, type Result } from '@mythos/contracts';
import type { AdapterDependencies } from '../registry';
import type { ProviderAdapter, ProviderError, TextRequest, TextResponse } from '../types';
import { type HttpResponse, parseWire, resolveApiKey, sendRequest } from './http';
import { streamError } from './http-errors';
import { readSseEvents } from './lines';
import {
  type ChatBody,
  ChunkSchema,
  CompletionSchema,
  ModelsSchema,
  type Usage,
  type WireMessage,
} from './openai-compatible-wire';
import { getJson, measureHealth } from './quick-calls';
import {
  createTextOutput,
  failedCall,
  type ReportedUsage,
  type TextOutput,
  textResponse,
} from './text-output';

/** A provider config whose `type` is `openai-compatible`. */
export type OpenAiCompatibleProviderConfig = Extract<ProviderConfig, { type: 'openai-compatible' }>;

/** What a call sends besides its body: the headers, and the API key to keep out of errors. */
type Auth = { headers: Record<string, string>; secrets: string[] };

/**
 * The `/chat/completions` body for `req`. A JSON format uses the profile's
 * structured-output method: `json-schema` sends `response_format`, `tool-call` sends one
 * tool and forces it with `tool_choice`, and `prompt-only` sends nothing (PRV-030). It
 * streams whenever the call has `onDelta`, and then asks for usage too. No thinking
 * parameter is sent, since servers name it differently.
 */
export function chatBody(req: TextRequest): ChatBody {
  const { profile, sampling, format } = req;
  const streamed = req.onDelta !== undefined;
  const body: ChatBody = {
    model: profile.model,
    messages: req.messages.map(({ role, content }) => ({ role, content })),
    max_tokens: req.maxOutputTokens,
    stream: streamed,
    temperature: sampling.temperature,
    top_p: sampling.topP,
    presence_penalty: sampling.presencePenalty,
    top_k: sampling.topK,
    repeat_penalty: sampling.repeatPenalty,
  };
  if (streamed) body.stream_options = { include_usage: true };
  if (format.type === 'json' && profile.structuredOutput === 'json-schema') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: format.schemaName, schema: format.jsonSchema, strict: true },
    };
  }
  if (format.type === 'json' && profile.structuredOutput === 'tool-call') {
    const name = format.schemaName;
    body.tools = [{ type: 'function', function: { name, parameters: format.jsonSchema } }];
    body.tool_choice = { type: 'function', function: { name } };
  }
  return body;
}

/**
 * Builds the adapter for one OpenAI-compatible server. Implements PRV-010 to PRV-013,
 * PRV-030, PRV-045 to PRV-047, and PRV-091.
 */
export function createOpenAiCompatibleAdapter(
  config: OpenAiCompatibleProviderConfig,
  deps: AdapterDependencies,
): ProviderAdapter {
  const provider = `${config.id} (OpenAI-compatible)`;
  const base = config.baseUrl.replace(/\/+$/, '');

  /** The configured headers, plus the bearer token when there is a key. */
  function auth(): Result<Auth, ProviderError> {
    if (config.apiKey === undefined) return ok({ headers: { ...config.headers }, secrets: [] });
    const key = resolveApiKey(config.apiKey, deps.env);
    if (!key.ok) return key;
    const headers = Object.fromEntries(
      Object.entries(config.headers).filter(([name]) => name.toLowerCase() !== 'authorization'),
    );
    return ok({
      headers: { ...headers, authorization: `Bearer ${key.value}` },
      secrets: [key.value],
    });
  }

  async function models(signal: AbortSignal): Promise<Result<string[], ProviderError>> {
    const authorized = auth();
    if (!authorized.ok) return authorized;
    const request = { provider, url: `${base}/models`, signal, ...authorized.value };
    const body = await getJson(request, ModelsSchema, deps.timeSource);
    return body.ok ? ok(body.value.data.map((model) => model.id)) : body;
  }

  async function generate(req: TextRequest): Promise<Result<TextResponse, ProviderError>> {
    const authorized = auth();
    if (!authorized.ok) return authorized;
    const { headers, secrets } = authorized.value;
    const sent = await sendRequest(
      {
        provider,
        method: 'POST',
        url: `${base}/chat/completions`,
        headers,
        body: chatBody(req),
        signal: req.signal,
        timeoutMs: req.profile.timeoutMs,
        secrets,
      },
      deps.timeSource,
    );
    if (!sent.ok) return sent;
    const reading: Reading = { req, provider, secrets };
    return req.onDelta === undefined
      ? readWhole(sent.value, reading)
      : readStream(sent.value, reading);
  }

  return {
    config,
    health: (signal) =>
      measureHealth(deps.timeSource, async () => {
        const listed = await models(signal);
        if (!listed.ok) return listed;
        const count = listed.value.length;
        const origin = new URL(base).origin;
        return ok(
          `${provider} is running at ${origin}, with ${String(count)} ` +
            `${count === 1 ? 'model' : 'models'}.`,
        );
      }),
    listModels: models,
    text: { generate },
  };
}

/** What reading a reply needs besides the reply. */
type Reading = { req: TextRequest; provider: string; secrets: readonly string[] };

async function readWhole(
  response: HttpResponse,
  { req, provider, secrets }: Reading,
): Promise<Result<TextResponse, ProviderError>> {
  const body = await response.json(CompletionSchema);
  if (!body.ok) return body;
  if (body.value.error != null) {
    return err(streamError(provider, JSON.stringify(body.value), secrets));
  }
  const choice = body.value.choices[0];
  if (choice === undefined) return err(noAnswer(provider));
  const output = createTextOutput(undefined);
  const refusal = apply(output, choice.message);
  return ok(
    finish(req, output, { reason: choice.finish_reason, refusal, usage: body.value.usage }),
  );
}

/** Reads a streamed reply event by event, passing answer text to `onDelta` as it comes. */
async function readStream(
  response: HttpResponse,
  { req, provider, secrets }: Reading,
): Promise<Result<TextResponse, ProviderError>> {
  const output = createTextOutput(req.onDelta);
  let reason: string | null | undefined = null;
  let refusal = '';
  let usage: Usage | null | undefined = null;
  for await (const event of readSseEvents(response.chunks())) {
    if (!event.ok) return failedCall(event.error, req, output);
    const { data } = event.value;
    if (event.value.event === 'error') return err(streamError(provider, data, secrets));
    const chunk = parseWire(data, ChunkSchema, provider);
    if (!chunk.ok) return chunk;
    if (chunk.value.error != null) return err(streamError(provider, data, secrets));
    usage = chunk.value.usage ?? usage;
    const choice = chunk.value.choices?.[0];
    if (choice === undefined) continue;
    if (choice.delta != null) refusal += apply(output, choice.delta);
    reason = choice.finish_reason ?? reason;
  }
  return ok(finish(req, output, { reason, refusal, usage }));
}

/**
 * Adds a message, or one streamed delta of it: reasoning as thinking, content (which may
 * hold `<think>` blocks), and the first tool call's arguments, which are the answer for
 * the `tool-call` method. Returns the refusal text it carries, if any. Implements PRV-046.
 */
function apply(output: TextOutput, message: WireMessage): string {
  const reasoning = message.reasoning_content ?? message.reasoning;
  if (reasoning != null) output.addThinking(reasoning);
  if (message.content != null) output.addContent(message.content);
  const call = message.tool_calls?.find((candidate) => (candidate.index ?? 0) === 0);
  const fragment = call?.function?.arguments;
  if (fragment != null) output.addToolArguments(fragment);
  return message.refusal ?? '';
}

/**
 * The response once the reply has ended. A refusal, or `finish_reason: 'content_filter'`,
 * is `ok` with `finishReason: 'refusal'` (CSET-050); its text is the answer, or the
 * refusal's own words when there is none. Counts the server left out are estimated.
 */
function finish(
  req: TextRequest,
  output: TextOutput,
  end: { reason: string | null | undefined; refusal: string; usage: Usage | null | undefined },
): TextResponse {
  output.end();
  const refused = end.refusal !== '' || end.reason === 'content_filter';
  const finishReason = refused ? 'refusal' : end.reason === 'length' ? 'length' : 'stop';
  const response = textResponse(req, output, finishReason, reported(end.usage));
  return response.text === '' && end.refusal !== '' ? { ...response, text: end.refusal } : response;
}

function reported(usage: Usage | null | undefined): ReportedUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? null,
  };
}

function noAnswer(provider: string): ProviderError {
  return {
    code: 'provider_unavailable',
    message: `${provider} sent a reply with no answer in it.`,
    retryable: true,
    httpStatus: null,
  };
}
