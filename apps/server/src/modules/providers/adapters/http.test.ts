import { err, ok, type Result } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ProviderError } from '../types';
import { type FakeServer, ndjsonLine, startFakeServer } from './fake-server';
import { type HttpRequest, type HttpResponse, resolveApiKey, sendRequest } from './http';
import { readNdjsonLines } from './lines';

const timeSource = { now: () => Date.parse('2026-11-05T12:00:00Z') };

let server: FakeServer;
beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    provider: 'Ollama',
    method: 'POST',
    url: `${server.baseUrl}/api/chat`,
    body: { model: 'qwen' },
    signal: new AbortController().signal,
    timeoutMs: 1000,
    ...overrides,
  };
}

function get(path: string): HttpRequest {
  return {
    provider: 'Ollama',
    method: 'GET',
    url: `${server.baseUrl}${path}`,
    signal: new AbortController().signal,
    timeoutMs: 1000,
  };
}

/** Sends a request that must succeed, and returns its response. */
async function opened(req: HttpRequest): Promise<HttpResponse> {
  const sent = await sendRequest(req, timeSource);
  if (!sent.ok) throw new Error(`Expected a response, got ${sent.error.message}`);
  return sent.value;
}

async function allChunks(response: HttpResponse): Promise<Result<string, ProviderError>[]> {
  const decoder = new TextDecoder();
  const read: Result<string, ProviderError>[] = [];
  for await (const chunk of response.chunks()) {
    read.push(chunk.ok ? ok(decoder.decode(chunk.value)) : chunk);
  }
  return read;
}

const ModelsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });

describe('sendRequest', () => {
  it('PRV-011: sends the method, headers, and JSON body, and parses a JSON response', async () => {
    server.reply('POST', '/api/chat', { type: 'json', body: { models: [{ name: 'qwen' }] } });
    const response = await opened(request({ headers: { 'x-title': 'Mythos' } }));

    expect(await response.json(ModelsSchema)).toEqual(ok({ models: [{ name: 'qwen' }] }));
    const [sent] = server.requests;
    expect(sent?.method).toBe('POST');
    expect(sent?.path).toBe('/api/chat');
    expect(sent?.headers['content-type']).toBe('application/json');
    expect(sent?.headers['x-title']).toBe('Mythos');
    expect(sent?.body).toEqual({ model: 'qwen' });
  });

  it('PRV-012: a body that is not JSON, or not the expected shape, is provider_unavailable', async () => {
    server.reply('GET', '/api/tags', { type: 'text', body: 'nope' }, { type: 'json', body: {} });
    const unreadable = (reason: string): ProviderError => ({
      code: 'provider_unavailable',
      message: `Ollama sent a response Mythos could not read (${reason}).`,
      retryable: true,
      httpStatus: null,
    });

    expect(await (await opened(get('/api/tags'))).json(ModelsSchema)).toEqual(
      err(unreadable('it is not JSON')),
    );
    expect(await (await opened(get('/api/tags'))).json(ModelsSchema)).toEqual(
      err(unreadable('models: Invalid input: expected array, received undefined')),
    );
  });

  it('PRV-013: a refused connection is provider_unavailable and retryable', async () => {
    const closed = await startFakeServer();
    await closed.close();
    const sent = await sendRequest(request({ url: `${closed.baseUrl}/api/chat` }), timeSource);
    expect(sent).toEqual(
      err({
        code: 'provider_unavailable',
        message:
          `Could not connect to Ollama at ${closed.baseUrl}: the connection was refused. ` +
          'Check that it is running and that the address is right.',
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-013: a connection dropped before the response is provider_unavailable', async () => {
    server.reply('POST', '/api/chat', { type: 'destroy' });
    expect(await sendRequest(request(), timeSource)).toEqual(
      err({
        code: 'provider_unavailable',
        message: `The connection to Ollama at ${server.baseUrl} closed unexpectedly.`,
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-013: a connection dropped in the middle of the body is provider_unavailable', async () => {
    server.reply('POST', '/api/chat', {
      type: 'stream',
      chunks: [ndjsonLine({ n: 1 }), { delayMs: 20, text: ndjsonLine({ n: 2 }) }],
      after: 'destroy',
    });
    const response = await opened(request());
    const lines = [];
    for await (const line of readNdjsonLines(response.chunks())) lines.push(line);
    expect(lines.slice(0, 2)).toEqual([ok('{"n":1}'), ok('{"n":2}')]);
    expect(lines[2]).toMatchObject(err({ code: 'provider_unavailable', retryable: true }));
  });

  it('PRV-013: no response headers within timeoutMs is provider_timeout', async () => {
    server.reply('POST', '/api/chat', { type: 'hang' });
    expect(await sendRequest(request({ timeoutMs: 50 }), timeSource)).toEqual(
      err({
        code: 'provider_timeout',
        message: `Ollama at ${server.baseUrl} sent nothing for 50 ms, so the call timed out.`,
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-013: a body that stalls for timeoutMs is provider_timeout', async () => {
    server.reply('POST', '/api/chat', { type: 'stream', chunks: ['first'], after: 'hang' });
    const response = await opened(request({ timeoutMs: 50 }));
    const read = await allChunks(response);
    expect(read[0]).toEqual(ok('first'));
    expect(read[1]).toMatchObject(err({ code: 'provider_timeout', retryable: true }));
  });

  it('PRV-013: timeoutMs bounds each wait, not the whole call', async () => {
    const chunks = Array.from({ length: 8 }, (_, n) => ({ delayMs: 40, text: String(n) }));
    server.reply('POST', '/api/chat', { type: 'stream', chunks });
    const started = performance.now();
    const response = await opened(request({ timeoutMs: 150 }));
    const read = await allChunks(response);
    expect(performance.now() - started).toBeGreaterThan(150);
    expect(read.map((chunk) => (chunk.ok ? chunk.value : chunk.error.code)).join('')).toBe(
      '01234567',
    );
  });

  it.each([
    ['authorization', 'Bearer sk-live\n123'],
    ['authorization', 'Bearer sk-live\u2019123'],
    ['bad header', 'fine'],
  ])(
    'PRV-013, CONV-072: a %s header fetch cannot send is provider_rejected, its value never quoted',
    async (name, value) => {
      const sent = await sendRequest(request({ headers: { [name]: value } }), timeSource);
      expect(sent).toEqual(
        err({
          code: 'provider_rejected',
          message:
            `Mythos could not send the request to Ollama: its ${name} header is not valid. ` +
            'Check the API key and headers in Settings.',
          retryable: false,
          httpStatus: null,
        }),
      );
      expect(server.requests).toEqual([]);
    },
  );

  it('PRV-013: whitespace around a header value is not a problem, since fetch trims it', async () => {
    server.reply('POST', '/api/chat', { type: 'json', body: {} });
    const sent = await sendRequest(
      request({ headers: { authorization: ' Bearer sk-live-123\r\n' } }),
      timeSource,
    );
    expect(sent.ok).toBe(true);
    expect(server.requests[0]?.headers.authorization).toBe('Bearer sk-live-123');
  });
});

describe('sendRequest when the caller aborts', () => {
  const cancelled: ProviderError = {
    code: 'cancelled',
    message: 'The call to Ollama was cancelled.',
    retryable: false,
    httpStatus: null,
  };

  it('PRV-047: a signal aborted before sending is cancelled, and nothing is sent', async () => {
    const sent = await sendRequest(request({ signal: AbortSignal.abort() }), timeSource);
    expect(sent).toEqual(err(cancelled));
    expect(server.requests).toEqual([]);
  });

  it('PRV-047: aborting while waiting for the response is cancelled', async () => {
    server.reply('POST', '/api/chat', { type: 'hang' });
    const caller = new AbortController();
    setTimeout(() => {
      caller.abort();
    }, 20);
    expect(await sendRequest(request({ signal: caller.signal }), timeSource)).toEqual(
      err(cancelled),
    );
  });

  it('PRV-047: aborting in the middle of the body is cancelled', async () => {
    server.reply('POST', '/api/chat', { type: 'stream', chunks: ['first'], after: 'hang' });
    const caller = new AbortController();
    const response = await opened(request({ signal: caller.signal }));
    const read: Result<string, ProviderError>[] = [];
    for await (const chunk of response.chunks()) {
      read.push(chunk.ok ? ok(new TextDecoder().decode(chunk.value)) : chunk);
      caller.abort();
    }
    expect(read).toEqual([ok('first'), err(cancelled)]);
  });

  it('PRV-013, PRV-047: an abort at the moment of a timeout is cancelled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.reply('POST', '/api/chat', { type: 'hang' });
    const caller = new AbortController();
    const pending = sendRequest(request({ signal: caller.signal, timeoutMs: 1000 }), timeSource);
    vi.advanceTimersByTime(1000); // the idle timeout fires and aborts the request…
    caller.abort(); // …and the caller aborts before the failure is mapped
    expect(await pending).toEqual(err(cancelled));
  });
});

describe('resolveApiKey', () => {
  it("PRV-013: a missing environment variable is provider_rejected, not retryable, with resolveSecret's message", () => {
    expect(resolveApiKey({ env: 'OPENROUTER_API_KEY' }, {})).toEqual(
      err({
        code: 'provider_rejected',
        message:
          'The environment variable OPENROUTER_API_KEY is not set. Set it, or enter the key in Settings.',
        retryable: false,
        httpStatus: null,
      }),
    );
  });

  it('PRV-013: a key is read from the environment or inline, without surrounding whitespace', () => {
    expect(resolveApiKey({ env: 'KEY' }, { KEY: 'sk-123\r\n' })).toEqual(ok('sk-123'));
    expect(resolveApiKey({ value: 'sk-456' }, {})).toEqual(ok('sk-456'));
  });
});
