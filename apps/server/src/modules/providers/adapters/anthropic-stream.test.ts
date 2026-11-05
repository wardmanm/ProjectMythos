import { err, ModelProfileSchema, ok, type Result } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import type { ProviderError, TextRequest, TextResponse } from '../types';
import {
  applyEvent,
  cancelStream,
  finishReasonOf,
  finishStream,
  startStream,
  type StreamState,
  streamError,
} from './anthropic-stream';
import type { SseEvent } from './lines';

const req: TextRequest = {
  role: 'narrator',
  profile: ModelProfileSchema.parse({
    id: 'opus',
    providerId: 'anthropic',
    model: 'claude-opus-5-5',
    kind: 'text',
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    structuredOutput: 'json-schema',
    charsPerToken: 4,
  }),
  messages: [{ role: 'user', content: 'Sixteen chars...' }],
  format: { type: 'text' },
  maxOutputTokens: 512,
  sampling: {},
  signal: new AbortController().signal,
};

/** One event as readSseEvents yields it, with its `type` in the data as Anthropic sends. */
function event(type: string, fields: Record<string, unknown> = {}): SseEvent {
  return { event: type, data: JSON.stringify({ type, ...fields }) };
}

function fold(events: readonly SseEvent[], onDelta?: (delta: string) => void): StreamState {
  const state = startStream();
  for (const each of events) {
    const applied = applyEvent(state, each, onDelta, []);
    if (!applied.ok) throw new Error(applied.error.message);
  }
  return state;
}

const textDelta = (text: string): SseEvent =>
  event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });

describe('the Anthropic stream fold', () => {
  it.each([
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['tool_use', 'stop'],
    ['pause_turn', 'stop'],
    ['max_tokens', 'length'],
    ['model_context_window_exceeded', 'length'],
    ['refusal', 'refusal'],
    ['a_reason_added_later', 'stop'],
  ] as const)('PRV-012: stop_reason %s is finishReason %s', (stopReason, finishReason) => {
    expect(finishReasonOf(stopReason)).toBe(finishReason);
  });

  it('PRV-012: the latest message_delta usage wins, and inputTokens counts cache reads and writes', () => {
    const state = fold([
      event('message_start', {
        message: { usage: { input_tokens: 12, cache_read_input_tokens: 0, output_tokens: 1 } },
      }),
      event('message_delta', { delta: { stop_reason: null }, usage: { output_tokens: 5 } }),
      event('message_delta', {
        delta: { stop_reason: 'end_turn' },
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 90,
          output_tokens: 31,
        },
      }),
      event('message_stop'),
    ]);
    const finished = finishStream(state, req);
    expect(finished.ok && finished.value.usage).toEqual({
      inputTokens: 900,
      outputTokens: 31,
      cachedInputTokens: 800,
    });
  });

  it('PRV-012: cachedInputTokens is null when the stream never reports cache reads', () => {
    const state = fold([
      event('message_start', { message: { usage: { input_tokens: 12, output_tokens: 1 } } }),
      event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }),
      event('message_stop'),
    ]);
    const finished = finishStream(state, req);
    expect(finished.ok && finished.value.usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cachedInputTokens: null,
    });
  });

  it('PRV-012: unknown event types are skipped, but a delta type the documentation does not list is unreadable', () => {
    const state = fold([event('ping'), event('a_new_event', { anything: 1 }), textDelta('Hi')]);
    expect(state.text).toBe('Hi');
    const unknownDelta = event('content_block_delta', {
      index: 0,
      delta: { type: 'mystery_delta', text: 'lost words' },
    });
    expect(applyEvent(startStream(), unknownDelta, undefined, [])).toMatchObject(
      err({ code: 'provider_unavailable', retryable: true }),
    );
  });

  it('PRV-012: a body that ends before message_stop is provider_unavailable, even with text', () => {
    const state = fold([textDelta('Half a sent')]);
    expect(finishStream(state, req)).toEqual(
      err({
        code: 'provider_unavailable',
        message: "Anthropic's response ended before the message was complete.",
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-040: with a tool_use block, the answer is its input; an empty input is {}', () => {
    const toolStart = event('content_block_start', {
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_1', name: 'ruling', input: {} },
    });
    const empty = fold([toolStart, event('message_stop')]);
    expect(finishStream(empty, req)).toMatchObject(ok({ text: '{}' }));
  });

  it.each([
    ['overloaded_error', 'provider_unavailable', true],
    ['api_error', 'provider_unavailable', true],
    ['rate_limit_error', 'rate_limited', true],
    ['timeout_error', 'provider_timeout', true],
    ['invalid_request_error', 'provider_rejected', false],
    ['billing_error', 'provider_rejected', false],
  ] as const)('PRV-013: a mid-stream %s error event is %s', (type, code, retryable) => {
    const data = JSON.stringify({ type: 'error', error: { type, message: 'It went wrong.' } });
    expect(streamError(data, [])).toMatchObject({
      code,
      message: `Anthropic stopped the response with an error (${type}): It went wrong.`,
      retryable,
      httpStatus: null,
    });
  });

  it('PRV-013, CONV-072: a mid-stream error message never shows the API key, and a 429-like one asks for no wait', () => {
    const data = JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: 'Key sk-ant-123 is over its limit.' },
    });
    expect(streamError(data, ['sk-ant-123'])).toEqual({
      code: 'rate_limited',
      message:
        'Anthropic stopped the response with an error (rate_limit_error): Key [redacted] is over its limit.',
      retryable: true,
      httpStatus: null,
      details: { retryAfterSeconds: null },
    });
  });

  it('PRV-047: a call cancelled before its message_delta estimates output from charsPerToken', () => {
    const state = fold([
      event('message_start', { message: { usage: { input_tokens: 40, output_tokens: 1 } } }),
      event('content_block_delta', {
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Hmm.' },
      }),
      textDelta('Twelve chars'),
    ]);
    const cancelled: ProviderError = {
      code: 'cancelled',
      message: 'The call to Anthropic was cancelled.',
      retryable: false,
      httpStatus: null,
    };
    const expected: Result<TextResponse, ProviderError> = ok({
      text: 'Twelve chars',
      thinking: 'Hmm.',
      // 16 characters of thinking and text at 4 per token
      usage: { inputTokens: 40, outputTokens: 4, cachedInputTokens: null },
      finishReason: 'cancelled',
    });
    expect(cancelStream(state, req, cancelled)).toEqual(expected);
    expect(cancelStream(startStream(), req, cancelled)).toEqual(err(cancelled));
  });
});
