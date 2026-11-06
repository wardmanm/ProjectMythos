import { err } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeServer, startFakeServer } from './fake-server';
import { type HttpRequest, RateLimitDetailsSchema, sendRequest } from './http';
import { parseRetryAfter, providerMessage, transportError } from './http-errors';

const where = {
  provider: 'Ollama',
  url: 'http://user:pass@10.0.0.5:11434/api/chat?key=k',
  timeoutMs: 1000,
};

/** The error Node's fetch rejects with for a network failure: a TypeError with a coded cause. */
function networkCause(code: string): Error {
  return Object.assign(new Error(`connect ${code}`), { code });
}

describe('transportError', () => {
  const cases: [code: string, expected: string, message: string][] = [
    [
      'ECONNREFUSED',
      'provider_unavailable',
      'Could not connect to Ollama at http://10.0.0.5:11434: the connection was refused. Check that it is running and that the address is right.',
    ],
    [
      'ENOTFOUND',
      'provider_unavailable',
      'Could not connect to Ollama: the address http://10.0.0.5:11434 could not be found. Check it in Settings.',
    ],
    [
      'EAI_AGAIN',
      'provider_unavailable',
      'Could not connect to Ollama: the address http://10.0.0.5:11434 could not be found. Check it in Settings.',
    ],
    [
      'ECONNRESET',
      'provider_unavailable',
      'The connection to Ollama at http://10.0.0.5:11434 closed unexpectedly.',
    ],
    [
      'UND_ERR_SOCKET',
      'provider_unavailable',
      'The connection to Ollama at http://10.0.0.5:11434 closed unexpectedly.',
    ],
    [
      'UND_ERR_CONNECT_TIMEOUT',
      'provider_unavailable',
      'Could not connect to Ollama at http://10.0.0.5:11434: the connection timed out.',
    ],
    [
      'ETIMEDOUT',
      'provider_unavailable',
      'Could not connect to Ollama at http://10.0.0.5:11434: the connection timed out.',
    ],
    [
      'UND_ERR_HEADERS_TIMEOUT',
      'provider_timeout',
      'Ollama at http://10.0.0.5:11434 stopped responding, so the call timed out.',
    ],
    [
      'UND_ERR_BODY_TIMEOUT',
      'provider_timeout',
      'Ollama at http://10.0.0.5:11434 stopped responding, so the call timed out.',
    ],
    [
      'EHOSTUNREACH',
      'provider_unavailable',
      'Could not reach Ollama at http://10.0.0.5:11434 (EHOSTUNREACH).',
    ],
  ];

  it.each(cases)('PRV-013: %s is %s and retryable', (code, expected, message) => {
    expect(transportError(networkCause(code), where)).toEqual({
      code: expected,
      message,
      retryable: true,
      httpStatus: null,
    });
  });

  it('PRV-013: an AggregateError from trying each address carries the code too', () => {
    const cause = Object.assign(new AggregateError([networkCause('ECONNREFUSED')]), {
      code: 'ECONNREFUSED',
    });
    expect(transportError(cause, where)).toMatchObject({ code: 'provider_unavailable' });
  });

  it('PRV-013, CONV-072: a cause with no code is provider_unavailable, and no message shows the path, query, or password', () => {
    const error = transportError(new Error('boom'), where);
    expect(error).toEqual({
      code: 'provider_unavailable',
      message: 'Could not reach Ollama at http://10.0.0.5:11434 (network error).',
      retryable: true,
      httpStatus: null,
    });
    expect(error.message).not.toMatch(/pass|key=|api\/chat/);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-05T12:00:00Z');
  const timeSource = { now: () => now };

  it.each([
    ['120', 120],
    ['0', 0],
    [' 1.5 ', 2],
    ['Thu, 05 Nov 2026 12:01:00 GMT', 60],
    ['Thu, 05 Nov 2026 12:00:00 GMT', 0],
    ['Thu, 05 Nov 2026 11:00:00 GMT', 0],
    ['soon', null],
    ['-5', null],
  ])('PRV-013: retry-after %j is %j seconds', (value, seconds) => {
    expect(parseRetryAfter(value, timeSource)).toBe(seconds);
  });

  it('PRV-013: no retry-after is null', () => {
    expect(parseRetryAfter(null, timeSource)).toBeNull();
  });
});

describe('providerMessage', () => {
  it('PRV-013: a long message is cut to 300 characters on one line', () => {
    const message = providerMessage(JSON.stringify({ error: `${'word '.repeat(100)}\nend` }), []);
    expect(message?.length).toBe(301);
    expect(message).toMatch(/^word word .*…$/);
  });

  it('PRV-013: a JSON body with no message field is quoted as text', () => {
    expect(providerMessage('{"code":7}', [])).toBe('{"code":7}');
  });
});

describe('statusError, through sendRequest', () => {
  const timeSource = { now: () => Date.parse('2026-11-05T12:00:00Z') };
  let server: FakeServer;
  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
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

  it('PRV-013: 429 is rate_limited and retryable, with retry-after in seconds', async () => {
    server.reply('POST', '/api/chat', {
      type: 'json',
      status: 429,
      headers: { 'retry-after': '7' },
      body: { error: { message: 'Slow down.' } },
    });
    expect(await sendRequest(request(), timeSource)).toEqual(
      err({
        code: 'rate_limited',
        message: 'Ollama is limiting requests (HTTP 429): Slow down. It asks to wait 7 seconds.',
        retryable: true,
        httpStatus: 429,
        details: { retryAfterSeconds: 7 },
      }),
    );
  });

  it('PRV-013: an HTTP-date retry-after is measured from the time source', async () => {
    server.reply('POST', '/api/chat', {
      type: 'text',
      status: 429,
      headers: { 'retry-after': 'Thu, 05 Nov 2026 12:00:30 GMT' },
      body: '',
    });
    const sent = await sendRequest(request(), timeSource);
    expect(sent.ok ? null : RateLimitDetailsSchema.parse(sent.error.details)).toEqual({
      retryAfterSeconds: 30,
    });
  });

  it('PRV-013: 429 with no retry-after has a null retryAfterSeconds', async () => {
    server.reply('POST', '/api/chat', { type: 'text', status: 429, body: '' });
    expect(await sendRequest(request(), timeSource)).toEqual(
      err({
        code: 'rate_limited',
        message: 'Ollama is limiting requests (HTTP 429).',
        retryable: true,
        httpStatus: 429,
        details: { retryAfterSeconds: null },
      }),
    );
  });

  it.each([500, 502, 503])(
    'PRV-013: HTTP %i is provider_unavailable and retryable',
    async (status) => {
      server.reply('POST', '/api/chat', { type: 'json', status, body: { error: 'out of memory' } });
      expect(await sendRequest(request(), timeSource)).toEqual(
        err({
          code: 'provider_unavailable',
          message: `Ollama had a server error (HTTP ${String(status)}): out of memory`,
          retryable: true,
          httpStatus: status,
        }),
      );
    },
  );

  const rejections: [label: string, status: number, body: unknown, said: string][] = [
    [
      'Ollama',
      404,
      { error: 'model "qwen" not found, try pulling it first' },
      ': model "qwen" not found, try pulling it first',
    ],
    [
      'OpenAI',
      400,
      { error: { message: 'Invalid schema.', type: 'invalid_request_error' } },
      ': Invalid schema.',
    ],
    [
      'Anthropic',
      401,
      { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
      ': invalid x-api-key',
    ],
    ['FastAPI', 422, { detail: 'max_tokens is too large' }, ': max_tokens is too large'],
    ['plain-text', 403, 'Forbidden\n  for this key', ': Forbidden for this key'],
    ['HTML', 404, '<html><body>Not Found</body></html>', '.'],
    ['empty', 400, '', '.'],
  ];

  it.each(rejections)(
    'PRV-013: a %s-style HTTP %i is provider_rejected, not retryable, in plain words',
    async (_label, status, body, said) => {
      const reply =
        typeof body === 'string'
          ? { type: 'text' as const, status, body }
          : { type: 'json' as const, status, body };
      server.reply('POST', '/api/chat', reply);
      expect(await sendRequest(request(), timeSource)).toEqual(
        err({
          code: 'provider_rejected',
          message: `Ollama rejected the request (HTTP ${String(status)})${said}`,
          retryable: false,
          httpStatus: status,
        }),
      );
    },
  );

  it('PRV-013, CONV-072: a secret quoted in the provider message is redacted', async () => {
    server.reply('POST', '/api/chat', {
      type: 'json',
      status: 401,
      body: { error: { message: 'Incorrect API key provided: sk-live-123.' } },
    });
    const sent = await sendRequest(request({ secrets: ['sk-live-123'] }), timeSource);
    expect(sent.ok ? null : sent.error.message).toBe(
      'Ollama rejected the request (HTTP 401): Incorrect API key provided: [redacted].',
    );
  });
});
