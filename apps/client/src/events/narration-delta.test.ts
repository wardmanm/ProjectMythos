import { describe, expect, it } from 'vitest';
import { writeNarrationDelta } from './narration-delta';

/** Writes each delta in turn, as the cache does. */
function writeAll(start: string | null, deltas: [number, string][]): string | null {
  let text = start;
  for (const [offset, delta] of deltas) text = writeNarrationDelta(text, offset, delta);
  return text;
}

describe('writeNarrationDelta', () => {
  it('UI-132: deltas append in order, starting from no narration', () => {
    expect(
      writeAll(null, [
        [0, 'The fog '],
        [8, 'has followed '],
        [21, 'you in.'],
      ]),
    ).toBe('The fog has followed you in.');
  });

  it('UI-132: a delta overlapping text already fetched mid-stream is written exactly once', () => {
    // GET /turns/:turnId answered with "The fog has" while the delta at 8 was in flight.
    expect(writeNarrationDelta('The fog has', 8, 'has followed ')).toBe('The fog has followed ');
    expect(
      writeAll('The fog has followed ', [
        [8, 'has followed '],
        [21, 'you in.'],
      ]),
    ).toBe('The fog has followed you in.');
  });

  it('UI-132: a replayed delta changes nothing', () => {
    expect(writeNarrationDelta('The fog has followed you in.', 8, 'has followed ')).toBe(
      'The fog has followed you in.',
    );
  });

  it('UI-132: a delta past the end of the text is a gap', () => {
    expect(writeNarrationDelta('The fog ', 21, 'you in.')).toBeNull();
    expect(writeNarrationDelta(null, 1, 'x')).toBeNull();
  });
});
