// The Anthropic adapter: text generation through the Messages API, always streamed, plus
// the model list and a health check (PRV-010, PRV-011). It uses `fetch` through
// `sendRequest`, never Anthropic's SDK (ADR-010). The request builder and the stream
// reader live beside it in anthropic-request.ts and anthropic-stream.ts.
import {
  err,
  type ModelProfile,
  ok,
  type ProviderConfig,
  type ProviderHealth,
  type Result,
} from '@mythos/contracts';
import { z } from 'zod';
import type { AdapterDependencies } from '../registry';
import type { ProviderAdapter, ProviderError, TextRequest, TextResponse } from '../types';
import { ANTHROPIC_VERSION, buildMessagesRequest } from './anthropic-request';
import { applyEvent, cancelStream, finishStream, startStream } from './anthropic-stream';
import { type HttpResponse, resolveApiKey, sendRequest } from './http';
import { readSseEvents } from './lines';

/** A provider config whose `type` is `anthropic`. */
export type AnthropicProviderConfig = Extract<ProviderConfig, { type: 'anthropic' }>;

const PROVIDER = 'Anthropic';

/** The API's origin, without `/v1`, as Anthropic's own SDKs take it. */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** The idle timeout for `health` and `listModels`, which have no profile to take it from. */
const LISTING_TIMEOUT_MS = 30_000;

/** The most models one page of `GET /v1/models` returns. */
const MODELS_PAGE_LIMIT = 1000;

const ModelsPageSchema = z.object({
  data: z.array(z.object({ id: z.string() })),
  has_more: z.boolean(),
  last_id: z.string().nullable(),
});

/** One request to the API, before the key and version headers are added. */
type ApiCall = {
  method: 'GET' | 'POST';
  /** From `/v1`, with any query string. */
  path: string;
  body?: unknown;
  signal: AbortSignal;
  timeoutMs: number;
};

/**
 * Builds the adapter for one `anthropic` provider. It serves text models only, so it has
 * no `embedding` member. `deps.env` holds an `{ env }` API key, and `deps.timeSource`
 * times `health`. Implements PRV-010 to PRV-013 and PRV-040 to PRV-047.
 */
export function createAnthropicAdapter(
  config: AnthropicProviderConfig,
  deps: AdapterDependencies,
): ProviderAdapter {
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

  /** Sends one call with the API key in `x-api-key` and the pinned version (PRV-011). */
  function send(apiKey: string, call: ApiCall): Promise<Result<HttpResponse, ProviderError>> {
    return sendRequest(
      {
        provider: PROVIDER,
        method: call.method,
        url: `${baseUrl}${call.path}`,
        headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
        ...(call.body === undefined ? {} : { body: call.body }),
        signal: call.signal,
        timeoutMs: call.timeoutMs,
        secrets: [apiKey],
      },
      deps.timeSource,
    );
  }

  async function generate(req: TextRequest): Promise<Result<TextResponse, ProviderError>> {
    const key = resolveApiKey(config.apiKey, deps.env);
    if (!key.ok) return key;
    const sent = await send(key.value, {
      method: 'POST',
      path: '/v1/messages',
      body: buildMessagesRequest(req),
      signal: req.signal,
      timeoutMs: req.profile.timeoutMs,
    });
    if (!sent.ok) return err(withThinkingHint(sent.error, req.profile));
    const state = startStream();
    for await (const event of readSseEvents(sent.value.chunks())) {
      if (!event.ok) {
        return event.error.code === 'cancelled' ? cancelStream(state, req, event.error) : event;
      }
      const applied = applyEvent(state, event.value, req.onDelta, [key.value]);
      if (!applied.ok) return applied;
      if (state.done) break;
    }
    return finishStream(state, req);
  }

  /** Every model the key can use, in the API's order, following `after_id` page by page. */
  async function listModels(signal: AbortSignal): Promise<Result<string[], ProviderError>> {
    const key = resolveApiKey(config.apiKey, deps.env);
    if (!key.ok) return key;
    const ids: string[] = [];
    let afterId: string | null = null;
    do {
      const query = new URLSearchParams({ limit: String(MODELS_PAGE_LIMIT) });
      if (afterId !== null) query.set('after_id', afterId);
      const sent = await send(key.value, {
        method: 'GET',
        path: `/v1/models?${query.toString()}`,
        signal,
        timeoutMs: LISTING_TIMEOUT_MS,
      });
      if (!sent.ok) return sent;
      const page = await sent.value.json(ModelsPageSchema);
      if (!page.ok) return page;
      ids.push(...page.value.data.map((model) => model.id));
      afterId = page.value.has_more ? page.value.last_id : null;
    } while (afterId !== null);
    return ok(ids);
  }

  /**
   * Lists one model, which needs a working key, and times the round trip. A key Anthropic
   * refuses (401 or 403) is unreachable, with a message that says to check it.
   */
  async function health(signal: AbortSignal): Promise<ProviderHealth> {
    const key = resolveApiKey(config.apiKey, deps.env);
    if (!key.ok) return { reachable: false, latencyMs: null, detail: key.error.message };
    const started = deps.timeSource.now();
    const sent = await send(key.value, {
      method: 'GET',
      path: '/v1/models?limit=1',
      signal,
      timeoutMs: LISTING_TIMEOUT_MS,
    });
    const page = sent.ok ? await sent.value.json(ModelsPageSchema) : sent;
    if (page.ok) {
      return {
        reachable: true,
        latencyMs: Math.max(0, deps.timeSource.now() - started),
        detail: `${PROVIDER} is reachable and accepted the API key.`,
      };
    }
    const { httpStatus, message } = page.error;
    const refusedKey = httpStatus === 401 || httpStatus === 403;
    return {
      reachable: false,
      latencyMs: null,
      detail: refusedKey ? addSentence(message, 'Check the API key in Settings.') : message,
    };
  }

  return { config, health, listModels, text: { generate } };
}

/**
 * Adds the setting to change to a 400 on a profile that turns thinking off, since some
 * models refuse to (owner). Anthropic's own explanation stays first. The hint is worded
 * for any 400, because which parameter the API objected to is only in its message text,
 * which code never branches on (CONV-042).
 */
function withThinkingHint(error: ProviderError, profile: ModelProfile): ProviderError {
  if (profile.thinking !== 'off' || error.httpStatus !== 400) return error;
  return {
    ...error,
    message: addSentence(
      error.message,
      'This profile turns thinking off, which some Anthropic models do not allow; if that is ' +
        "the problem, set the profile's thinking to provider-default in Settings.",
    ),
  };
}

/** `more` after `message`, ending `message` with a full stop if it has none. */
function addSentence(message: string, more: string): string {
  return /[.!?…]$/.test(message) ? `${message} ${more}` : `${message}. ${more}`;
}
