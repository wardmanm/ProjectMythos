// What the Ollama and OpenAI-compatible adapters build a `TextResponse` from, as it
// arrives: answer text, which goes to `onDelta`; thinking, from a field of its own or from
// inline `<think>` blocks, which never does (PRV-046); and, for the `tool-call` method, the
// tool call's arguments, which are the answer. Also the two ways a call ends: finished,
// with usage reported or estimated, or failed, where an abort keeps the text so far
// (PRV-047).
import { err, ok, type Result, type TokenUsage } from '@mythos/contracts';
import { estimateTokens } from '../tokens';
import type { ProviderError, TextRequest, TextResponse } from '../types';
import { createThinkTagSplitter } from './think-tags';

/** One call's output so far. */
export type TextOutput = {
  /** Model content, which may hold inline `<think>` blocks. Its answer part goes to `onDelta`. */
  addContent: (delta: string) => void;
  /** Reasoning from a field of its own. Never streamed. */
  addThinking: (delta: string) => void;
  /** A piece of the first tool call's arguments. Goes to `onDelta`. */
  addToolArguments: (delta: string) => void;
  /** Whether any tool call has arrived, so later ones can be ignored. */
  hasToolCall: () => boolean;
  /** Passes on any text the `<think>` splitter held back. Call once, at the end. */
  end: () => void;
  /** The answer: the tool call's arguments if one came, else the content's answer text. */
  text: () => string;
  /** The thinking, trimmed, or null if there was none. */
  thinking: () => string | null;
};

/** A new output. `onDelta` is the request's: undefined for a call that is not streamed. */
export function createTextOutput(onDelta: ((delta: string) => void) | undefined): TextOutput {
  const splitter = createThinkTagSplitter();
  let answer = '';
  let thinking = '';
  let toolArguments: string | null = null;

  function take(split: { answer: string; thinking: string }): void {
    thinking += split.thinking;
    if (split.answer === '') return;
    answer += split.answer;
    onDelta?.(split.answer);
  }

  return {
    addContent: (delta) => {
      take(splitter.push(delta));
    },
    addThinking: (delta) => {
      thinking += delta;
    },
    addToolArguments: (delta) => {
      toolArguments = (toolArguments ?? '') + delta;
      if (delta !== '') onDelta?.(delta);
    },
    hasToolCall: () => toolArguments !== null,
    end: () => {
      take(splitter.end());
    },
    text: () => toolArguments ?? answer,
    thinking: () => (thinking.trim() === '' ? null : thinking.trim()),
  };
}

/** Token counts a provider reported; null for any it left out. */
export type ReportedUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
};

/** For a provider that reported nothing, as when a stream was cut off. */
export const NO_USAGE: ReportedUsage = {
  inputTokens: null,
  outputTokens: null,
  cachedInputTokens: null,
};

/**
 * The finished call's `TextResponse`. A count the provider left out is estimated from
 * the profile's `charsPerToken`, as the mock does (PRV-070). Call `output.end()` first.
 */
export function textResponse(
  req: TextRequest,
  output: TextOutput,
  finishReason: TextResponse['finishReason'],
  reported: ReportedUsage,
): TextResponse {
  const text = output.text();
  const thinking = output.thinking();
  const ratio = req.profile.charsPerToken;
  const prompt = req.messages.map((message) => message.content).join('');
  const usage: TokenUsage = {
    inputTokens: reported.inputTokens ?? estimateTokens(prompt, ratio),
    outputTokens: reported.outputTokens ?? estimateTokens(text + (thinking ?? ''), ratio),
    cachedInputTokens: reported.cachedInputTokens,
  };
  return { text, thinking, usage, finishReason };
}

/**
 * A call that failed part way. An abort after answer text arrived returns that text as
 * `ok`, with `finishReason: 'cancelled'` and estimated usage; an abort before any, even
 * with thinking received, and every other failure, is the error. Implements PRV-047.
 */
export function failedCall(
  error: ProviderError,
  req: TextRequest,
  output: TextOutput,
): Result<TextResponse, ProviderError> {
  output.end();
  if (error.code !== 'cancelled' || output.text() === '') return err(error);
  return ok(textResponse(req, output, 'cancelled', NO_USAGE));
}
