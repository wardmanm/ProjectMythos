import { type AppError, CommitPayloadSchema, err, ok } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import type { StreamedText } from '../providers';
import {
  fitDelta,
  NARRATION_MAX_CHARS,
  NO_TEXT,
  narrationOutcome,
  REFUSED,
  type StreamEnd,
} from './narration-outcome';

const streamed = (text: string, finishReason: StreamedText['finishReason']): StreamEnd => ({
  type: 'streamed',
  result: ok({ text, finishReason }),
});
const failed = (error: AppError): StreamEnd => ({ type: 'streamed', result: err(error) });
const unavailable: AppError = { code: 'provider_unavailable', message: 'The server went away.' };
const cancelled: AppError = { code: 'cancelled', message: 'Cancelled.' };

describe('narrationOutcome', () => {
  it('TRN-051: finished text is committed complete; a length stop, a Stop, or the cap commits it incomplete', () => {
    expect(narrationOutcome(streamed('Rain.', 'stop'), 'Rain.', false)).toEqual({
      type: 'commit',
      complete: true,
      error: null,
    });
    for (const reason of ['length', 'cancelled'] as const) {
      expect(narrationOutcome(streamed('Rain', reason), 'Rain', false)).toEqual({
        type: 'commit',
        complete: false,
        error: null,
      });
    }
    expect(narrationOutcome(streamed('Rain.', 'stop'), 'Rain', true)).toEqual({
      type: 'commit',
      complete: false,
      error: null,
    });
  });

  it('TRN-052: a failure after some text keeps it, incomplete, with the error; before any, the stage fails', () => {
    expect(narrationOutcome(failed(unavailable), 'The door', false)).toEqual({
      type: 'commit',
      complete: false,
      error: unavailable,
    });
    expect(narrationOutcome(failed(unavailable), '', false)).toEqual({
      type: 'fail',
      error: unavailable,
    });
    const notConfigured: AppError = { code: 'not_configured', message: 'No narrator.' };
    expect(narrationOutcome({ type: 'prompt-failed', error: notConfigured }, '', false)).toEqual({
      type: 'fail',
      error: notConfigured,
    });
  });

  it('TRN-149: a Stop before any text is stopped, whether it came before the call or during it', () => {
    expect(narrationOutcome({ type: 'stopped-before-call' }, '', false)).toEqual({
      type: 'stopped',
    });
    expect(narrationOutcome(failed(cancelled), '', false)).toEqual({ type: 'stopped' });
    expect(narrationOutcome(streamed('', 'cancelled'), '', false)).toEqual({ type: 'stopped' });
    // A cancelled error with text forwarded is a Stop too: the text is kept, no error shown.
    expect(narrationOutcome(failed(cancelled), 'Rain', false)).toEqual({
      type: 'commit',
      complete: false,
      error: null,
    });
  });

  it('CSET-050: a refusal fails the stage, keeping only text the client was sent, never the refusal', () => {
    expect(narrationOutcome(streamed('I will not write that.', 'refusal'), '', false)).toEqual({
      type: 'fail',
      error: REFUSED,
    });
    expect(
      narrationOutcome(streamed('The rain falls. I will not', 'refusal'), 'The rain falls.', false),
    ).toEqual({
      type: 'commit',
      complete: false,
      error: REFUSED,
    });
    expect(REFUSED.message).not.toMatch(/will not/);
  });

  it('TRN-052: a model that finishes without a word fails the stage, so it can be retried', () => {
    expect(narrationOutcome(streamed('', 'stop'), '', false)).toEqual({
      type: 'fail',
      error: NO_TEXT,
    });
  });
});

describe('fitDelta', () => {
  it('TRN-051: narration stops at narration.set’s limit, never splitting a surrogate pair', () => {
    const atLimit = {
      type: 'narration.set',
      text: 'x'.repeat(NARRATION_MAX_CHARS),
      complete: false,
    };
    expect(CommitPayloadSchema.safeParse(atLimit).success).toBe(true);
    const over = { ...atLimit, text: `${atLimit.text}x` };
    expect(CommitPayloadSchema.safeParse(over).success).toBe(false);

    expect(fitDelta('rain ', 10)).toBe('rain ');
    expect(fitDelta('rain ', 2)).toBe('ra');
    expect(fitDelta('rain', 0)).toBe('');
    // '🌧' is two UTF-16 code units: a cut between them drops the whole character.
    expect(fitDelta('a🌧b', 2)).toBe('a');
    expect(fitDelta('a🌧b', 3)).toBe('a🌧');
  });
});
