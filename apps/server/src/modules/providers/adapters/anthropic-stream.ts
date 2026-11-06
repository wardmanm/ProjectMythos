// Reads Anthropic's streamed Messages response: Zod schemas for the server-sent events the
// adapter uses, and the fold that assembles them into a TextResponse (PRV-012). Events it
// does not know, such as `ping`, are skipped, as Anthropic's versioning policy asks. Its
// documentation, read 2026-11-05, lists every event and delta type handled here.
import { err, ok, type Result, type TokenUsage } from '@mythos/contracts';
import { z } from 'zod';
import { estimateTokens } from '../tokens';
import type { ProviderError, TextRequest, TextResponse } from '../types';
import { parseWire } from './http';
import { providerMessage } from './http-errors';
import type { SseEvent } from './lines';

const PROVIDER = 'Anthropic';

/** Token counts. Each may be absent or null in an event that does not report it. */
const UsageSchema = z.object({
  input_tokens: z.int().nonnegative().nullish(),
  output_tokens: z.int().nonnegative().nullish(),
  cache_read_input_tokens: z.int().nonnegative().nullish(),
  cache_creation_input_tokens: z.int().nonnegative().nullish(),
});
type WireUsage = z.infer<typeof UsageSchema>;

const MessageStartSchema = z.object({ message: z.object({ usage: UsageSchema.optional() }) });

const BlockStartSchema = z.object({
  index: z.int().nonnegative(),
  content_block: z.object({ type: z.string() }),
});

/**
 * Every delta type the documentation lists. One it does not list fails to parse rather
 * than being skipped, since it might carry answer text: the pinned API version and the
 * absence of beta headers keep the list fixed.
 */
const DeltaSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text_delta'), text: z.string() }),
  z.object({ type: z.literal('thinking_delta'), thinking: z.string() }),
  z.object({ type: z.literal('input_json_delta'), partial_json: z.string() }),
  z.object({ type: z.literal('signature_delta') }),
  z.object({ type: z.literal('citations_delta') }),
]);

const BlockDeltaSchema = z.object({ index: z.int().nonnegative(), delta: DeltaSchema });

const MessageDeltaSchema = z.object({
  delta: z.object({ stop_reason: z.string().nullish() }),
  usage: UsageSchema.optional(),
});

const StreamErrorSchema = z.object({ error: z.object({ type: z.string(), message: z.string() }) });

/** What a stream has delivered so far. `generate` keeps one per call. */
export type StreamState = {
  text: string;
  thinking: string;
  /** The index of the first `tool_use` block, whose input is the answer (tool-call). */
  toolIndex: number | null;
  toolInput: string;
  input: number | null;
  cacheRead: number | null;
  cacheCreation: number | null;
  /** Output tokens from a `message_delta`; `message_start`'s count is only a placeholder. */
  output: number | null;
  stopReason: string | null;
  /** `message_stop` arrived: the message is complete. */
  done: boolean;
};

export function startStream(): StreamState {
  return {
    text: '',
    thinking: '',
    toolIndex: null,
    toolInput: '',
    input: null,
    cacheRead: null,
    cacheCreation: null,
    output: null,
    stopReason: null,
    done: false,
  };
}

/**
 * Folds one event into `state`. Answer text goes to `onDelta` as it arrives; thinking
 * never does (PRV-045, PRV-046). Signatures and `redacted_thinking` blocks are dropped,
 * since the engine never sends thinking back. An `error` event, or an event that does not
 * parse, ends the call with its error. Implements PRV-012, PRV-045, and PRV-046.
 */
export function applyEvent(
  state: StreamState,
  event: SseEvent,
  onDelta: ((delta: string) => void) | undefined,
  secrets: readonly string[],
): Result<void, ProviderError> {
  switch (event.event) {
    case 'message_start': {
      const parsed = parseWire(event.data, MessageStartSchema, PROVIDER);
      if (!parsed.ok) return parsed;
      recordUsage(state, parsed.value.message.usage);
      return ok(undefined);
    }
    case 'content_block_start': {
      const parsed = parseWire(event.data, BlockStartSchema, PROVIDER);
      if (!parsed.ok) return parsed;
      const { index, content_block: block } = parsed.value;
      if (block.type === 'tool_use' && state.toolIndex === null) state.toolIndex = index;
      return ok(undefined);
    }
    case 'content_block_delta': {
      const parsed = parseWire(event.data, BlockDeltaSchema, PROVIDER);
      if (!parsed.ok) return parsed;
      applyDelta(state, parsed.value, onDelta);
      return ok(undefined);
    }
    case 'message_delta': {
      const parsed = parseWire(event.data, MessageDeltaSchema, PROVIDER);
      if (!parsed.ok) return parsed;
      const { delta, usage } = parsed.value;
      state.stopReason = delta.stop_reason ?? state.stopReason;
      recordUsage(state, usage);
      state.output = usage?.output_tokens ?? state.output;
      return ok(undefined);
    }
    case 'message_stop':
      state.done = true;
      return ok(undefined);
    case 'error':
      return err(streamError(event.data, secrets));
    default:
      // ping, content_block_stop, and event types added later carry nothing to keep.
      return ok(undefined);
  }
}

function applyDelta(
  state: StreamState,
  { index, delta }: z.infer<typeof BlockDeltaSchema>,
  onDelta: ((delta: string) => void) | undefined,
): void {
  switch (delta.type) {
    case 'text_delta':
      state.text += delta.text;
      if (delta.text !== '') onDelta?.(delta.text);
      return;
    case 'thinking_delta':
      state.thinking += delta.thinking;
      return;
    case 'input_json_delta':
      if (index === state.toolIndex) state.toolInput += delta.partial_json;
      return;
    case 'signature_delta':
    case 'citations_delta':
      return;
  }
}

/**
 * Keeps each input count an event reports: `message_start` has them, and a
 * `message_delta` may repeat them. Its counts are cumulative, so the latest one wins.
 */
function recordUsage(state: StreamState, usage: WireUsage | undefined): void {
  if (usage === undefined) return;
  state.input = usage.input_tokens ?? state.input;
  state.cacheRead = usage.cache_read_input_tokens ?? state.cacheRead;
  state.cacheCreation = usage.cache_creation_input_tokens ?? state.cacheCreation;
}

/**
 * A complete stream as a TextResponse, or `provider_unavailable` if the body ended before
 * `message_stop`. A refusal is a response, not an error (CSET-050). Implements PRV-012.
 */
export function finishStream(
  state: StreamState,
  req: TextRequest,
): Result<TextResponse, ProviderError> {
  if (!state.done) {
    return err({
      code: 'provider_unavailable',
      message: `${PROVIDER}'s response ended before the message was complete.`,
      retryable: true,
      httpStatus: null,
    });
  }
  const text = state.toolIndex === null ? state.text : toolAnswer(state.toolInput);
  return ok({
    text,
    thinking: state.thinking === '' ? null : state.thinking,
    usage: usageOf(state, text, req),
    finishReason: finishReasonOf(state.stopReason),
  });
}

/** A tool's input as answer text. An empty input streams no JSON at all, and stands for `{}`. */
function toolAnswer(input: string): string {
  return input === '' ? '{}' : input;
}

/**
 * An aborted stream: what arrived, marked `cancelled`, or the `cancelled` error if no
 * answer text did. Implements PRV-047.
 */
export function cancelStream(
  state: StreamState,
  req: TextRequest,
  cancelled: ProviderError,
): Result<TextResponse, ProviderError> {
  const text = state.toolIndex === null ? state.text : state.toolInput;
  if (text === '') return err(cancelled);
  return ok({
    text,
    thinking: state.thinking === '' ? null : state.thinking,
    usage: usageOf(state, text, req),
    finishReason: 'cancelled',
  });
}

/**
 * Anthropic's `stop_reason` as a finish reason. Every reason not listed, including any
 * added later, is a normal stop.
 */
export function finishReasonOf(stopReason: string | null): TextResponse['finishReason'] {
  switch (stopReason) {
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'length';
    case 'refusal':
      return 'refusal';
    default:
      // end_turn, stop_sequence, tool_use, pause_turn
      return 'stop';
  }
}

/**
 * The whole prompt as `inputTokens`, since Anthropic's `input_tokens` leaves out cache
 * reads and writes, and the cache reads as `cachedInputTokens` (05-providers Decisions).
 * A count the stream never reported is estimated from the profile's `charsPerToken`:
 * output, when a call is cancelled before its `message_delta`.
 */
function usageOf(state: StreamState, answer: string, req: TextRequest): TokenUsage {
  const ratio = req.profile.charsPerToken;
  const inputTokens =
    state.input === null
      ? estimateTokens(req.messages.map((message) => message.content).join(''), ratio)
      : state.input + (state.cacheRead ?? 0) + (state.cacheCreation ?? 0);
  const outputTokens = state.output ?? estimateTokens(state.thinking + answer, ratio);
  return { inputTokens, outputTokens, cachedInputTokens: state.cacheRead };
}

/**
 * The ProviderError for an `error` event, by its `error.type`: overloaded and internal
 * errors are `provider_unavailable`, a rate limit is `rate_limited`, a timeout is
 * `provider_timeout`, and any other is `provider_rejected`. It is an error even after
 * text has arrived; only an abort keeps partial text. Implements PRV-013.
 */
export function streamError(data: string, secrets: readonly string[]): ProviderError {
  const parsed = parseWire(data, StreamErrorSchema, PROVIDER);
  if (!parsed.ok) return parsed.error;
  const { type } = parsed.value.error;
  const said = providerMessage(data, secrets) ?? type;
  const message = `${PROVIDER} stopped the response with an error (${type}): ${said}`;
  switch (type) {
    case 'overloaded_error':
    case 'api_error':
      return { code: 'provider_unavailable', message, retryable: true, httpStatus: null };
    case 'rate_limit_error':
      return {
        code: 'rate_limited',
        message,
        retryable: true,
        httpStatus: null,
        details: { retryAfterSeconds: null },
      };
    case 'timeout_error':
      return { code: 'provider_timeout', message, retryable: true, httpStatus: null };
    default:
      return { code: 'provider_rejected', message, retryable: false, httpStatus: null };
  }
}
