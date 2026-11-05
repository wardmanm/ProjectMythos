// What the Anthropic adapter's tests share: a config, profile, and request to start from,
// and the server-sent events Anthropic streams, built the way its documentation shows
// them (read 2026-11-05). Test-only, like fake-server.ts, and not exported from index.ts.
import {
  type ModelProfile,
  ModelProfileSchema,
  type ProviderConfig,
  ProviderConfigSchema,
  type Result,
} from '@mythos/contracts';
import { z } from 'zod';
import { type AdapterDependencies, createAdapter } from '../registry';
import type { ProviderAdapter, ProviderError, TextRequest, TextResponse } from '../types';
import { type FakeChunk, type FakeServer, sseEvent } from './fake-server';

export const API_KEY = 'sk-ant-test-123';

export function anthropicConfig(baseUrl: string): ProviderConfig {
  return ProviderConfigSchema.parse({
    id: 'anthropic',
    type: 'anthropic',
    deviceId: 'cloud',
    apiKey: { env: 'ANTHROPIC_API_KEY' },
    baseUrl,
  });
}

/** The adapter, through the registry, with API_KEY in its environment unless `deps` says. */
export function anthropicAdapter(
  baseUrl: string,
  deps: Partial<AdapterDependencies> = {},
): ProviderAdapter {
  return createAdapter(anthropicConfig(baseUrl), {
    env: { ANTHROPIC_API_KEY: API_KEY },
    timeSource: { now: () => Date.parse('2026-11-05T12:00:00Z') },
    ...deps,
  });
}

/** A text profile with 4 characters per token, so estimates are easy to work out. */
export function anthropicProfile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return ModelProfileSchema.parse({
    id: 'opus',
    providerId: 'anthropic',
    model: 'claude-opus-5-5',
    kind: 'text',
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    structuredOutput: 'json-schema',
    thinking: 'provider-default',
    charsPerToken: 4,
    timeoutMs: 1000,
    ...overrides,
  });
}

export function textRequest(overrides: Partial<TextRequest> = {}): TextRequest {
  return {
    role: 'narrator',
    profile: anthropicProfile(),
    messages: [{ role: 'user', content: 'I push the door open.' }],
    format: { type: 'text' },
    maxOutputTokens: 256,
    sampling: {},
    signal: new AbortController().signal,
    ...overrides,
  };
}

export async function generate(
  adapter: ProviderAdapter,
  req: TextRequest,
): Promise<Result<TextResponse, ProviderError>> {
  const text = adapter.text;
  if (text === undefined) throw new Error('The anthropic adapter has no text member.');
  return text.generate(req);
}

export function valueOf(result: Result<TextResponse, ProviderError>): TextResponse {
  if (result.ok) return result.value;
  throw new Error(`Expected a response, got ${result.error.code}: ${result.error.message}`);
}

export function errorOf(result: Result<unknown, ProviderError>): ProviderError {
  if (result.ok) throw new Error('Expected an error, got ok');
  return result.error;
}

/** Queues one streamed reply to `POST /v1/messages`. */
export function replyStream(
  server: FakeServer,
  chunks: readonly FakeChunk[],
  after?: 'end' | 'hang' | 'destroy',
): void {
  server.reply('POST', '/v1/messages', {
    type: 'stream',
    headers: { 'content-type': 'text/event-stream' },
    chunks,
    ...(after === undefined ? {} : { after }),
  });
}

/** The JSON body of the first request the server received. */
export function sentBody(server: FakeServer): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(server.requests[0]?.body);
}

// ---------------------------------------------------------------- events

/** One event, named in its `event:` line and in its data's `type`, as Anthropic sends. */
export function sse(type: string, fields: Record<string, unknown> = {}): string {
  return sseEvent({ type, ...fields }, type);
}

export function messageStart(
  usage: Record<string, number> = { input_tokens: 25, output_tokens: 1 },
): string {
  return sse('message_start', {
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-opus-5-5',
      usage,
    },
  });
}

export function blockStart(index: number, block: Record<string, unknown>): string {
  return sse('content_block_start', { index, content_block: block });
}

export function delta(index: number, value: Record<string, unknown>): string {
  return sse('content_block_delta', { index, delta: value });
}

export function textDelta(index: number, text: string): string {
  return delta(index, { type: 'text_delta', text });
}

export function blockStop(index: number): string {
  return sse('content_block_stop', { index });
}

export function messageDelta(
  stopReason: string,
  usage: Record<string, number> = { output_tokens: 9 },
): string {
  return sse('message_delta', { delta: { stop_reason: stopReason, stop_sequence: null }, usage });
}

export function messageStop(): string {
  return sse('message_stop');
}

/** A complete stream of one text block made of `parts`, with a `ping` in it. */
export function textStream(parts: readonly string[], stopReason = 'end_turn'): string[] {
  return [
    messageStart(),
    blockStart(0, { type: 'text', text: '' }),
    sse('ping'),
    ...parts.map((part) => textDelta(0, part)),
    blockStop(0),
    messageDelta(stopReason),
    messageStop(),
  ];
}
