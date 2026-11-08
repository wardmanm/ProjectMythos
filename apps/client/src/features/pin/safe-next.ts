/** Any origin will do: it only tells an address within the app from one that leaves it. */
const BASE = 'http://mythos.invalid';

/**
 * Where the PIN screen goes once the PIN is accepted: `next` when it is an address within
 * the app, else the library. An address must start with one `/` (not `//` or `/\`, which
 * browsers read as another host), still be on the same origin once parsed (parsing drops
 * tabs and line breaks, so `/\t/x` becomes `//x`), and not be the PIN screen itself. The
 * path, query, and hash are kept.
 */
export function safeNext(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return '/';
  }
  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return '/';
  }
  if (url.origin !== BASE) return '/';
  if (url.pathname.replace(/\/+$/, '') === '/pin') return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}
