import { TurnStatusSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { turnAt } from './play-testing';
import { headOf, inputAvailability, statusLine } from './turn-status';

describe('turn status', () => {
  it('TRN-058: input is available only when the head is complete, extraction-failed, or world-tick-failed', () => {
    const available = TurnStatusSchema.options.filter(
      (status) => inputAvailability(turnAt(3, { status }), false).available,
    );
    expect(available).toEqual(['complete', 'extraction-failed', 'world-tick-failed']);
  });

  it('UI-073: unavailable input says why, for every status and while sending', () => {
    for (const status of TurnStatusSchema.options) {
      const availability = inputAvailability(turnAt(3, { status }), false);
      if (!availability.available) expect(availability.reason, status).not.toBe('');
    }
    expect(inputAvailability(turnAt(3, { status: 'narrating' }), false)).toEqual({
      available: false,
      reason: 'The GM is writing…',
    });
    expect(inputAvailability(turnAt(3), true)).toEqual({ available: false, reason: 'Sending…' });
    expect(inputAvailability(null, false)).toEqual({
      available: false,
      reason: 'Opening the story…',
    });
  });

  it('UI-073: a failed opening can only be retried; a later failed turn can be cancelled too', () => {
    expect(inputAvailability(turnAt(0, { status: 'stage-failed' }), false)).toEqual({
      available: false,
      reason: 'Retry the opening first.',
    });
    expect(inputAvailability(turnAt(4, { status: 'stage-failed' }), false)).toEqual({
      available: false,
      reason: 'Retry or cancel the failed turn first.',
    });
  });

  it('UI-054: a status line shows for each status while work is underway, and none once it is done', () => {
    const shown = TurnStatusSchema.options.filter((status) => statusLine[status] !== null);
    expect(shown).toEqual(['adjudicating', 'narrating', 'extracting', 'world-ticking']);
    expect(statusLine.narrating).toBe('Writing…');
    expect(statusLine.extracting).toBe('Remembering…');
  });

  it('TRN-058: the head is the last listed turn that is not abandoned', () => {
    const turns = [turnAt(0), turnAt(1), turnAt(2, { status: 'abandoned' })];
    expect(headOf(turns)?.turn.depth).toBe(1);
    expect(headOf([])).toBeNull();
  });
});
