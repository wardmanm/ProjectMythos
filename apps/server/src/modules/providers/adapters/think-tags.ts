// Separates inline `<think>…</think>` reasoning from answer text as it streams (PRV-046).
// Some models write their reasoning inline instead of in a field of its own. A tag can be
// split across deltas, so the end of each delta that could still be the start of a tag is
// held back until the next delta, or `end`, shows what it is.

/** The answer text and thinking text found in one piece of output. Either may be empty. */
export type ThinkSplit = { answer: string; thinking: string };

/** Splits a stream of text deltas, in order. Call `end` once, after the last delta. */
export type ThinkTagSplitter = {
  push: (delta: string) => ThinkSplit;
  end: () => ThinkSplit;
};

const OPEN = '<think>';
const CLOSE = '</think>';

/**
 * A new splitter. Text inside `<think>…</think>` is thinking, and everything else is
 * answer; the tags themselves are neither. A block left open at the end is thinking.
 * A stray `</think>` with no `<think>` before it is dropped. Whitespace straight after a
 * closing tag is dropped, since models put a blank line there. Implements PRV-046.
 */
export function createThinkTagSplitter(): ThinkTagSplitter {
  let inside = false;
  let held = '';
  let afterClose = false;

  function emit(text: string, out: ThinkSplit): void {
    if (inside) {
      out.thinking += text;
      return;
    }
    const answer = afterClose ? text.trimStart() : text;
    if (answer !== '') afterClose = false;
    out.answer += answer;
  }

  function push(delta: string): ThinkSplit {
    const out: ThinkSplit = { answer: '', thinking: '' };
    let rest = held + delta;
    held = '';
    let tag = nextTag(rest, inside);
    while (tag !== null) {
      emit(rest.slice(0, tag.index), out);
      rest = rest.slice(tag.index + tag.text.length);
      inside = tag.text === OPEN;
      afterClose = tag.text === CLOSE;
      tag = nextTag(rest, inside);
    }
    const keep = partialTagLength(rest, inside ? [CLOSE] : [OPEN, CLOSE]);
    emit(rest.slice(0, rest.length - keep), out);
    held = rest.slice(rest.length - keep);
    return out;
  }

  function end(): ThinkSplit {
    const out: ThinkSplit = { answer: '', thinking: '' };
    emit(held, out);
    held = '';
    return out;
  }

  return { push, end };
}

/** The first tag in `text` that matters: `</think>` inside a block, either tag outside. */
function nextTag(text: string, inside: boolean): { index: number; text: string } | null {
  const close = text.indexOf(CLOSE);
  const open = inside ? -1 : text.indexOf(OPEN);
  if (open !== -1 && (close === -1 || open < close)) return { index: open, text: OPEN };
  if (close !== -1) return { index: close, text: CLOSE };
  return null;
}

/** How many characters at the end of `text` could be the start of one of `tags`. */
function partialTagLength(text: string, tags: readonly string[]): number {
  for (let length = Math.min(text.length, CLOSE.length - 1); length > 0; length -= 1) {
    const tail = text.slice(text.length - length);
    if (tags.some((tag) => tag.startsWith(tail))) return length;
  }
  return 0;
}
