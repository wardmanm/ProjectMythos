// PRV-013 and PRV-047 for both local text adapters: every way a call can fail, against a
// fake server, with the code, retryability, and HTTP status each must give.
import { err, ok, type Result } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter, ProviderError, TextRequest, TextResponse } from '../types';
import {
  type FakeChunk,
  type FakeServer,
  ndjsonLine,
  sseEvent,
  startFakeServer,
} from './fake-server';
import {
  generateWith,
  ollamaAt,
  ollamaContentLine,
  ollamaThinkingLine,
  openAiCompatibleAt,
  testProfile,
  textRequest,
} from './testing';

/** How one adapter's provider speaks: its chat path and how a stream carries text. */
type Dialect = {
  name: string;
  /** What error messages call the provider. */
  provider: string;
  chatPath: string;
  make: (baseUrl: string) => ProviderAdapter;
  textChunk: (text: string) => FakeChunk;
  thinkingChunk: (thinking: string) => FakeChunk;
  errorChunk: (message: string) => FakeChunk;
  unreadable: unknown;
};

const dialects: Dialect[] = [
  {
    name: 'ollama',
    provider: 'Ollama',
    chatPath: '/api/chat',
    make: (baseUrl) => ollamaAt(baseUrl),
    textChunk: ollamaContentLine,
    thinkingChunk: ollamaThinkingLine,
    errorChunk: (message) => ndjsonLine({ error: message }),
    unreadable: { message: 'not an object' },
  },
  {
    name: 'openai-compatible',
    provider: 'lm-studio (OpenAI-compatible)',
    chatPath: '/v1/chat/completions',
    make: (baseUrl) => openAiCompatibleAt(baseUrl),
    textChunk: (content) => sseEvent({ choices: [{ index: 0, delta: { content } }] }),
    thinkingChunk: (reasoning) =>
      sseEvent({ choices: [{ index: 0, delta: { reasoning_content: reasoning } }] }),
    errorChunk: (message) => sseEvent({ error: { message } }),
    unreadable: { choices: 'not a list' },
  },
];

describe.each(dialects)('the $name adapter', (dialect) => {
  let server: FakeServer;
  beforeEach(async () => {
    server = await startFakeServer();
  });
  afterEach(async () => {
    await server.close();
  });

  function generate(
    req: TextRequest,
    baseUrl = server.baseUrl,
  ): Promise<Result<TextResponse, ProviderError>> {
    return generateWith(dialect.make(baseUrl), req);
  }

  /** A streamed request that aborts once `after` deltas have reached onDelta. */
  function abortingRequest(after: number): TextRequest {
    const caller = new AbortController();
    let seen = 0;
    return textRequest({
      signal: caller.signal,
      onDelta: () => {
        seen += 1;
        if (seen === after) caller.abort();
      },
    });
  }

  it('PRV-013: a refused connection is provider_unavailable and retryable', async () => {
    const closed = await startFakeServer();
    await closed.close();
    expect(await generate(textRequest(), closed.baseUrl)).toMatchObject(
      err({ code: 'provider_unavailable', retryable: true, httpStatus: null }),
    );
  });

  it('PRV-013: no reply within the profile timeoutMs is provider_timeout and retryable', async () => {
    server.reply('POST', dialect.chatPath, { type: 'hang' });
    const req = textRequest({ profile: testProfile({ timeoutMs: 50 }) });
    expect(await generate(req)).toEqual(
      err({
        code: 'provider_timeout',
        message: `${dialect.provider} at ${server.baseUrl} sent nothing for 50 ms, so the call timed out.`,
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-013: a stream that stalls for timeoutMs after text is provider_timeout', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'stream',
      chunks: [dialect.textChunk('The door ')],
      after: 'hang',
    });
    const req = textRequest({ profile: testProfile({ timeoutMs: 50 }), onDelta: () => undefined });
    expect(await generate(req)).toMatchObject(err({ code: 'provider_timeout', retryable: true }));
  });

  it('PRV-013: 429 is rate_limited and retryable, with retryAfterSeconds', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'json',
      status: 429,
      headers: { 'retry-after': '12' },
      body: { error: 'Too many requests.' },
    });
    expect(await generate(textRequest())).toEqual(
      err({
        code: 'rate_limited',
        message: `${dialect.provider} is limiting requests (HTTP 429): Too many requests. It asks to wait 12 seconds.`,
        retryable: true,
        httpStatus: 429,
        details: { retryAfterSeconds: 12 },
      }),
    );
  });

  it('PRV-013: 500 is provider_unavailable and retryable', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'json',
      status: 500,
      body: { error: 'model crashed' },
    });
    expect(await generate(textRequest())).toEqual(
      err({
        code: 'provider_unavailable',
        message: `${dialect.provider} had a server error (HTTP 500): model crashed`,
        retryable: true,
        httpStatus: 500,
      }),
    );
  });

  it('PRV-013: 400 is provider_rejected and not retryable', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'json',
      status: 400,
      body: { error: 'bad schema' },
    });
    expect(await generate(textRequest())).toEqual(
      err({
        code: 'provider_rejected',
        message: `${dialect.provider} rejected the request (HTTP 400): bad schema`,
        retryable: false,
        httpStatus: 400,
      }),
    );
  });

  it('PRV-013: an error inside a 200 stream is provider_unavailable, even after text', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'stream',
      chunks: [dialect.textChunk('The door '), dialect.errorChunk('out of memory')],
    });
    expect(await generate(textRequest({ onDelta: () => undefined }))).toEqual(
      err({
        code: 'provider_unavailable',
        message: `${dialect.provider} stopped with an error: out of memory`,
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-012, PRV-013: a reply the adapter cannot read is provider_unavailable', async () => {
    server.reply('POST', dialect.chatPath, { type: 'json', body: dialect.unreadable });
    expect(await generate(textRequest())).toMatchObject(
      err({ code: 'provider_unavailable', retryable: true, httpStatus: null }),
    );
  });

  it('PRV-013: a connection dropped after text is still an error', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'stream',
      chunks: [dialect.textChunk('The door ')],
      after: 'destroy',
    });
    expect(await generate(textRequest({ onDelta: () => undefined }))).toMatchObject(
      err({ code: 'provider_unavailable', retryable: true }),
    );
  });

  const cancelled = (provider: string): ProviderError => ({
    code: 'cancelled',
    message: `The call to ${provider} was cancelled.`,
    retryable: false,
    httpStatus: null,
  });

  it('PRV-047: an abort before any reply is the cancelled error', async () => {
    server.reply('POST', dialect.chatPath, { type: 'hang' });
    const caller = new AbortController();
    setTimeout(() => {
      caller.abort();
    }, 20);
    expect(await generate(textRequest({ signal: caller.signal }))).toEqual(
      err(cancelled(dialect.provider)),
    );
  });

  it('PRV-047: an abort after text returns the text so far, marked cancelled', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'stream',
      chunks: [dialect.textChunk('The door '), dialect.textChunk('opens')],
      after: 'hang',
    });
    expect(await generate(abortingRequest(2))).toEqual(
      ok({
        text: 'The door opens',
        thinking: null,
        usage: { inputTokens: 8, outputTokens: 4, cachedInputTokens: null },
        finishReason: 'cancelled',
      }),
    );
  });

  it('PRV-047: an abort with only thinking received is the cancelled error', async () => {
    server.reply('POST', dialect.chatPath, {
      type: 'stream',
      chunks: [dialect.thinkingChunk('Is it locked?')],
      after: 'hang',
    });
    const caller = new AbortController();
    setTimeout(() => {
      caller.abort();
    }, 50);
    const req = textRequest({ signal: caller.signal, onDelta: () => undefined });
    expect(await generate(req)).toEqual(err(cancelled(dialect.provider)));
  });
});
