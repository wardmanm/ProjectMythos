import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeServer, ndjsonLine, sseEvent, startFakeServer } from './fake-server';

let server: FakeServer;
beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  await server.close();
});

describe('startFakeServer', () => {
  it('CONV-113: listens on 127.0.0.1 and records each request', async () => {
    expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    server.reply('POST', '/api/chat', { type: 'json', body: {} });
    server.reply('POST', '/raw', { type: 'json', body: {} });
    server.reply('GET', '/api/tags', { type: 'json', body: {} });

    await fetch(`${server.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test': 'yes' },
      body: JSON.stringify({ model: 'qwen' }),
    });
    await fetch(`${server.baseUrl}/raw`, { method: 'POST', body: 'not json' });
    await fetch(`${server.baseUrl}/api/tags?verbose=1`);

    expect(server.requests.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
      { method: 'POST', path: '/api/chat', body: { model: 'qwen' } },
      { method: 'POST', path: '/raw', body: 'not json' },
      { method: 'GET', path: '/api/tags?verbose=1', body: null },
    ]);
    expect(server.requests[0]?.headers['x-test']).toBe('yes');
  });

  it('CONV-113: replies to each route in the order scripted, with status and headers', async () => {
    server.reply(
      'GET',
      '/api/version',
      { type: 'json', body: { version: '1' } },
      { type: 'text', status: 503, headers: { 'retry-after': '3' }, body: 'busy' },
    );
    const first = await fetch(`${server.baseUrl}/api/version`);
    const second = await fetch(`${server.baseUrl}/api/version`);

    expect([first.status, await first.json()]).toEqual([200, { version: '1' }]);
    expect([second.status, second.headers.get('retry-after'), await second.text()]).toEqual([
      503,
      '3',
      'busy',
    ]);
  });

  it('CONV-113: a request with nothing scripted gets a 501 that names it', async () => {
    const response = await fetch(`${server.baseUrl}/api/chat`, { method: 'POST' });
    expect([response.status, await response.json()]).toEqual([
      501,
      { error: 'The fake server has no reply scripted for POST /api/chat.' },
    ]);
  });

  it('CONV-113: streams chunks as separate writes, with pauses', async () => {
    server.reply('POST', '/stream', {
      type: 'stream',
      chunks: [ndjsonLine({ n: 1 }), { delayMs: 30, text: sseEvent('[DONE]', 'end') }],
    });
    const response = await fetch(`${server.baseUrl}/stream`, { method: 'POST' });
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    /** The next chunk as text, or null at the end of the body. */
    async function nextText(): Promise<string | null> {
      const next = await reader?.read();
      const value: unknown = next?.value;
      return value instanceof Uint8Array ? decoder.decode(value) : null;
    }

    expect(await nextText()).toBe('{"n":1}\n');
    const started = performance.now();
    expect(await nextText()).toBe('event: end\ndata: [DONE]\n\n');
    expect(performance.now() - started).toBeGreaterThan(20);
    expect(await nextText()).toBeNull();
  });

  it('CONV-113: close ends a request left hanging', async () => {
    server.reply('POST', '/api/chat', { type: 'hang' });
    const pending = fetch(`${server.baseUrl}/api/chat`, { method: 'POST' }).then(
      () => 'answered',
      () => 'dropped',
    );
    while (server.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    await server.close();
    expect(await pending).toBe('dropped');
  });
});
