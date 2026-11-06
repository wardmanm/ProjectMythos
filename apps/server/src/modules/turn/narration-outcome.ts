// What a narration leaves when it ends (06-turn-engine §5.4), decided from how its
// stream ended and the text that reached the client. Pure: the runner in narration.ts
// writes and publishes the result.
import type { AppError, Result } from '@mythos/contracts';
import type { StreamedText } from '../providers';

/** `narration.set`'s limit on its text (03-contracts §10). */
export const NARRATION_MAX_CHARS = 20_000;

/** How a narration's model call ended. */
export type StreamEnd =
  /** The prompt could not be built: no narrator assigned, too big, a broken override. */
  | { type: 'prompt-failed'; error: AppError }
  /** Stopped while the prompt was being built, before any model call. */
  | { type: 'stopped-before-call' }
  | { type: 'streamed'; result: Result<StreamedText, AppError> };

/** What the turn is left with. */
export type NarrationOutcome =
  /** Commit the text forwarded so far; `error`, when there is one, is shown with it. */
  | { type: 'commit'; complete: boolean; error: AppError | null }
  /** Nothing to keep: the turn becomes `stage-failed` (TRN-052). */
  | { type: 'fail'; error: AppError }
  /** Stopped before any text arrived (TRN-149). */
  | { type: 'stopped' };

/** A refusal fails the stage like any other failure (CSET-050). The model's words stay out. */
export const REFUSED: AppError = {
  code: 'provider_rejected',
  message: "The narrator's model refused to write this narration.",
};

/** A model that finished without a word: there is nothing to keep, so it can be retried. */
export const NO_TEXT: AppError = {
  code: 'provider_rejected',
  message: 'The narrator returned no text.',
};

/** The outcome when no text reached the client. */
function outcomeWithoutText(result: Result<StreamedText, AppError>): NarrationOutcome {
  if (!result.ok) {
    return result.error.code === 'cancelled'
      ? { type: 'stopped' }
      : { type: 'fail', error: result.error };
  }
  if (result.value.finishReason === 'cancelled') return { type: 'stopped' };
  return { type: 'fail', error: result.value.finishReason === 'refusal' ? REFUSED : NO_TEXT };
}

/**
 * What a narration leaves, given how it ended and the text forwarded to the client,
 * which is the only text ever committed. `cut` is true when the text reached
 * `NARRATION_MAX_CHARS` and the rest was dropped. Implements TRN-051, TRN-052, and
 * CSET-050.
 */
export function narrationOutcome(end: StreamEnd, text: string, cut: boolean): NarrationOutcome {
  if (end.type === 'prompt-failed') return { type: 'fail', error: end.error };
  if (end.type === 'stopped-before-call') return { type: 'stopped' };
  const { result } = end;
  if (text.length === 0) return outcomeWithoutText(result);
  // Text arrived, so it is kept, marked incomplete if anything cut it short (TRN-051).
  if (!result.ok) {
    const stopped = result.error.code === 'cancelled';
    return { type: 'commit', complete: false, error: stopped ? null : result.error };
  }
  const { finishReason } = result.value;
  if (finishReason === 'refusal') return { type: 'commit', complete: false, error: REFUSED };
  return { type: 'commit', complete: finishReason === 'stop' && !cut, error: null };
}

/**
 * The part of `delta` that fits in `room` characters, never splitting a surrogate pair,
 * so a cut narration stays valid text.
 */
export function fitDelta(delta: string, room: number): string {
  if (delta.length <= room) return delta;
  if (room <= 0) return '';
  const last = delta.charCodeAt(room - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return delta.slice(0, splitsPair ? room - 1 : room);
}
