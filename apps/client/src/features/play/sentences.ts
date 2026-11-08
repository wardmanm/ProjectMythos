/**
 * Where a sentence ends: one or more of `. ! ? …`, any closing quotes or brackets, and
 * then whitespace, or a paragraph break (a blank line). The whitespace must have arrived,
 * so a sentence still streaming ("The fog." may become "The fog.”") is not yet whole.
 */
const sentenceEnd = /[.!?…]+["'”’)\]»]*(?=\s)|\n[ \t]*\n/g;

/**
 * The text up to the end of its last whole sentence, or '' when no sentence has ended.
 * Implements UI-053's sentence-at-a-time streaming under reduced motion, and the
 * sentences UI-112 announces.
 */
export function wholeSentences(text: string): string {
  let end = 0;
  for (const match of text.matchAll(sentenceEnd)) {
    // A paragraph break ends the sentence before it; the break itself is not kept.
    end = match[0].startsWith('\n') ? match.index : match.index + match[0].length;
  }
  return text.slice(0, end);
}
