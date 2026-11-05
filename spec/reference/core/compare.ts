/**
 * Code-point string comparison (CONV-087). Never use localeCompare for ordering that
 * reaches stored data or prompts: its result depends on the machine's locale. Plain `<`
 * is no substitute: it compares UTF-16 code units, which puts characters beyond U+FFFF
 * before U+E000 to U+FFFF, unlike code-point order and SQLite's BINARY collation.
 */
export function cmp(a: string, b: string): number {
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i) ?? 0, y = b.codePointAt(j) ?? 0;
    if (x !== y) return x < y ? -1 : 1;
    i += x > 0xffff ? 2 : 1;
    j += y > 0xffff ? 2 : 1;
  }
  return i < a.length ? 1 : j < b.length ? -1 : 0;
}
