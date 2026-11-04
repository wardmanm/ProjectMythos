/**
 * Orders two strings by Unicode code point: negative if `a` comes first, positive if `b`
 * does, 0 if they are equal. Use it for every ordering that reaches stored data, prompts,
 * or tests; `localeCompare` depends on the machine's locale (ADR-011).
 *
 * Plain `<` is no substitute: it compares UTF-16 code units, which puts characters beyond
 * U+FFFF (stored as two surrogates from 0xD800) before U+E000 to U+FFFF. Code-point order
 * also matches SQLite's default BINARY collation.
 */
// Implements CONV-087.
export function cmp(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0;
    const y = b.codePointAt(j) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    // A code point beyond U+FFFF takes two UTF-16 code units.
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  // Equal so far: the string with code points left over comes second.
  if (i < a.length) return 1;
  if (j < b.length) return -1;
  return 0;
}
