// Builders for the adapters' own tests: a model profile, a text request, the dependencies
// an adapter takes, each adapter pointed at a fake server, and the replies each provider
// sends. Test-only, and not exported from index.ts.
import {
  type ModelProfile,
  ModelProfileSchema,
  ProviderConfigSchema,
  type Result,
} from '@mythos/contracts';
import type { z } from 'zod';
import type { AdapterDependencies } from '../registry';
import type {
  ProviderAdapter,
  ProviderError,
  ResponseFormat,
  TextRequest,
  TextResponse,
} from '../types';
import { type FakeReply, ndjsonLine, sseEvent } from './fake-server';
import { createOllamaAdapter } from './ollama';
import { createOpenAiCompatibleAdapter } from './openai-compatible';

/** A fixed wall time, so `retry-after` dates and latencies are exact. */
export const TEST_NOW = Date.parse('2026-11-05T12:00:00Z');

export const testDeps: AdapterDependencies = {
  env: { LOCAL_KEY: 'sk-local-123' },
  timeSource: { now: () => TEST_NOW },
};

/**
 * A text profile with 4 characters per token, so estimated counts are easy to check,
 * and a 1-second timeout. `overrides` are applied before parsing.
 */
export function testProfile(
  overrides: Partial<z.input<typeof ModelProfileSchema>> = {},
): ModelProfile {
  return ModelProfileSchema.parse({
    id: 'qwen-local',
    providerId: 'local',
    model: 'qwen3.6:35b-a3b',
    kind: 'text',
    contextWindow: 32768,
    maxOutputTokens: 1024,
    structuredOutput: 'json-schema',
    charsPerToken: 4,
    timeoutMs: 1000,
    ...overrides,
  });
}

/** A JSON format with a small schema, for the structured-output methods. */
export const rulingFormat: ResponseFormat = {
  type: 'json',
  schemaName: 'ruling',
  jsonSchema: {
    type: 'object',
    properties: { outcome: { type: 'string' } },
    required: ['outcome'],
    additionalProperties: false,
  },
};

/** A narrator call with a 29-character prompt (8 estimated tokens), not streamed. */
export function textRequest(overrides: Partial<TextRequest> = {}): TextRequest {
  return {
    role: 'narrator',
    profile: testProfile(),
    messages: [
      { role: 'system', content: 'You are the GM.', cacheBreakpoint: true },
      { role: 'user', content: 'I knock twice.' },
    ],
    format: { type: 'text' },
    maxOutputTokens: 512,
    sampling: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A `tool-call` request for `rulingFormat`, streamed when `onDelta` is given. */
export function toolRequest(onDelta?: (delta: string) => void): TextRequest {
  return textRequest({
    format: rulingFormat,
    profile: testProfile({ structuredOutput: 'tool-call' }),
    ...(onDelta === undefined ? {} : { onDelta }),
  });
}

/** The Ollama adapter for the server at `baseUrl`, with `keepAlive: '30m'`. */
export function ollamaAt(baseUrl: string, deps: AdapterDependencies = testDeps): ProviderAdapter {
  const config = ProviderConfigSchema.parse({
    id: 'ollama-local',
    type: 'ollama',
    baseUrl: `${baseUrl}/`,
    deviceId: 'gpu',
    keepAlive: '30m',
  });
  if (config.type !== 'ollama') throw new Error('Expected an ollama config.');
  return createOllamaAdapter(config, deps);
}

/** The OpenAI-compatible adapter "lm-studio" for `<baseUrl>/v1`, with `extra` config fields. */
export function openAiCompatibleAt(
  baseUrl: string,
  extra: Record<string, unknown> = {},
): ProviderAdapter {
  const config = ProviderConfigSchema.parse({
    id: 'lm-studio',
    type: 'openai-compatible',
    baseUrl: `${baseUrl}/v1`,
    deviceId: 'gpu',
    ...extra,
  });
  if (config.type !== 'openai-compatible') throw new Error('Expected an openai-compatible config.');
  return createOpenAiCompatibleAdapter(config, testDeps);
}

/** Calls the adapter's text member, which every text adapter has. */
export function generateWith(
  adapter: ProviderAdapter,
  req: TextRequest,
): Promise<Result<TextResponse, ProviderError>> {
  if (adapter.text === undefined) throw new Error('The adapter has no text member.');
  return adapter.text.generate(req);
}

/** Ollama's final line of a streamed reply, or the whole of one that is not, with counts. */
export function ollamaDone(content: string, extra: Record<string, unknown> = {}) {
  return {
    model: 'qwen3.6:35b-a3b',
    message: { role: 'assistant', content },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 120,
    prompt_eval_cached_count: 100,
    eval_count: 9,
    ...extra,
  };
}

/** One line of an Ollama stream carrying answer text. */
export function ollamaContentLine(content: string): string {
  return ndjsonLine({ message: { role: 'assistant', content }, done: false });
}

/** One line of an Ollama stream carrying thinking. */
export function ollamaThinkingLine(thinking: string): string {
  return ndjsonLine({ message: { role: 'assistant', content: '', thinking }, done: false });
}

/** The usage every scripted OpenAI-compatible reply reports. */
export const openAiUsage = {
  prompt_tokens: 120,
  completion_tokens: 9,
  prompt_tokens_details: { cached_tokens: 100 },
};

/** An OpenAI-compatible reply that is not streamed, with one choice holding `message`. */
export function openAiCompletion(
  message: Record<string, unknown>,
  finishReason = 'stop',
): FakeReply {
  return {
    type: 'json',
    body: {
      choices: [
        { index: 0, message: { role: 'assistant', ...message }, finish_reason: finishReason },
      ],
      usage: openAiUsage,
    },
  };
}

/** A streamed OpenAI-compatible reply: an event per delta, a finish, the usage, `[DONE]`. */
export function openAiStream(deltas: Record<string, unknown>[], finishReason = 'stop'): FakeReply {
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    sseEvent({ choices: [{ index: 0, delta, finish_reason: finish }] });
  return {
    type: 'stream',
    chunks: [
      ...deltas.map((delta) => chunk(delta, null)),
      chunk({}, finishReason),
      sseEvent({ choices: [], usage: openAiUsage }),
      sseEvent('[DONE]'),
    ],
  };
}
