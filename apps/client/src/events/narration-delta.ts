/**
 * The narration after writing `delta` at `offset`, or null when `offset` is past the end
 * of `text`: a gap, so text was missed and the turn must be refetched.
 *
 * Implements UI-101: a delta is written at its offset, not appended, so text the client
 * already fetched mid-stream (TRN-150) is not repeated, and a replayed delta changes
 * nothing. A turn with no narration yet starts from ''.
 */
export function writeNarrationDelta(
  text: string | null,
  offset: number,
  delta: string,
): string | null {
  const current = text ?? '';
  if (offset > current.length) return null;
  return current.slice(0, offset) + delta + current.slice(offset + delta.length);
}
