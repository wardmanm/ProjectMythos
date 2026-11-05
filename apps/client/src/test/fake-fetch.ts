// A stand-in for fetch, so no test touches the network (CONV-113). Each test says what the
// server answers; anything else gets the server's not_found error body.
import { vi } from 'vitest';

/** An answer: a status and a JSON body, or a raw text body, or no answer at all. */
export type FakeAnswer =
  { status: number; body?: unknown } | { status: number; text: string } | { unreachable: true };

export type FetchCall = { method: string; url: string; body: unknown };

const answers = new Map<string, FakeAnswer>();
const calls: FetchCall[] = [];

/** Installs the fake with no answers. The test setup calls it before each test. */
export function installFakeFetch(): void {
  answers.clear();
  calls.length = 0;
  vi.stubGlobal('fetch', fakeFetch);
}

/** Sets the answer to `method url`, e.g. `answer('GET', '/api/campaigns', { status: 200, body: [] })`. */
export function answer(method: string, url: string, fake: FakeAnswer): void {
  answers.set(`${method} ${url}`, fake);
}

/** The requests sent so far, oldest first. */
export function fetchCalls(): readonly FetchCall[] {
  return calls;
}

function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = init.method ?? 'GET';
  const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
  calls.push({ method, url: input, body });
  const fake = answers.get(`${method} ${input}`) ?? {
    status: 404,
    body: { error: { code: 'not_found', message: `no fake answer for ${method} ${input}` } },
  };
  if ('unreachable' in fake) return Promise.reject(new TypeError('Failed to fetch'));
  const headers = { 'Content-Type': 'application/json' };
  if ('text' in fake) return Promise.resolve(new Response(fake.text, { status: fake.status }));
  const json = fake.body === undefined ? null : JSON.stringify(fake.body);
  return Promise.resolve(new Response(json, { status: fake.status, headers }));
}
