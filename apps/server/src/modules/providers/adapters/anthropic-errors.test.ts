import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderAdapter, ProviderError, TextRequest } from '../types';
import {
  anthropicAdapter,
  anthropicProfile,
  API_KEY,
  blockStart,
  errorOf,
  generate,
  messageStart,
  replyStream,
  sentBody,
  sse,
  textDelta,
  textRequest,
} from './anthropic-testing';
import { type FakeReply, type FakeServer, startFakeServer } from './fake-server';

let server: FakeServer;
beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  await server.close();
});

/** Anthropic's error body. */
function errorBody(type: string, message: string): unknown {
  return { type: 'error', error: { type, message }, request_id: 'req_1' };
}

function replyStatus(
  status: number,
  type: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  const reply: FakeReply = { type: 'json', status, headers, body: errorBody(type, message) };
  server.reply('POST', '/v1/messages', reply);
}

/** What one case changes: the request, or the adapter it is sent through. */
type Arranged = Partial<TextRequest> & { adapter?: ProviderAdapter };

const cases: [name: string, arrange: () => Promise<Arranged>, expected: Partial<ProviderError>][] =
  [
    [
      'a refused connection is provider_unavailable',
      async () => {
        const closed = await startFakeServer();
        await closed.close();
        return { adapter: anthropicAdapter(closed.baseUrl) };
      },
      { code: 'provider_unavailable', retryable: true, httpStatus: null },
    ],
    [
      'no response within timeoutMs is provider_timeout',
      () => {
        server.reply('POST', '/v1/messages', { type: 'hang' });
        return Promise.resolve({ profile: anthropicProfile({ timeoutMs: 50 }) });
      },
      { code: 'provider_timeout', retryable: true, httpStatus: null },
    ],
    [
      'a 429 is rate_limited, with the wait retry-after asks for',
      () => {
        replyStatus(429, 'rate_limit_error', 'Slow down.', { 'retry-after': '7' });
        return Promise.resolve({});
      },
      { code: 'rate_limited', retryable: true, httpStatus: 429, details: { retryAfterSeconds: 7 } },
    ],
    [
      'a 529 overloaded_error is provider_unavailable',
      () => {
        replyStatus(529, 'overloaded_error', 'Overloaded');
        return Promise.resolve({});
      },
      { code: 'provider_unavailable', retryable: true, httpStatus: 529 },
    ],
    [
      'a 500 api_error is provider_unavailable',
      () => {
        replyStatus(500, 'api_error', 'Internal server error');
        return Promise.resolve({});
      },
      { code: 'provider_unavailable', retryable: true, httpStatus: 500 },
    ],
    [
      "a 400 is provider_rejected, quoting Anthropic's message",
      () => {
        replyStatus(400, 'invalid_request_error', 'max_tokens: too large');
        return Promise.resolve({});
      },
      {
        code: 'provider_rejected',
        retryable: false,
        httpStatus: 400,
        message: 'Anthropic rejected the request (HTTP 400): max_tokens: too large',
      },
    ],
    [
      'a 401 is provider_rejected',
      () => {
        replyStatus(401, 'authentication_error', 'invalid x-api-key');
        return Promise.resolve({});
      },
      { code: 'provider_rejected', retryable: false, httpStatus: 401 },
    ],
    [
      'an error event after some text is still an error',
      () => {
        replyStream(server, [
          messageStart(),
          blockStart(0, { type: 'text', text: '' }),
          textDelta(0, 'Once '),
          sse('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }),
        ]);
        return Promise.resolve({});
      },
      {
        code: 'provider_unavailable',
        retryable: true,
        httpStatus: null,
        message: 'Anthropic stopped the response with an error (overloaded_error): Overloaded',
      },
    ],
    [
      'an abort before any text is cancelled',
      () => {
        replyStream(server, [messageStart()], 'hang');
        const caller = new AbortController();
        setTimeout(() => {
          caller.abort();
        }, 30);
        return Promise.resolve({ signal: caller.signal });
      },
      { code: 'cancelled', retryable: false, httpStatus: null },
    ],
    [
      'an API key whose environment variable is not set is provider_rejected',
      () => Promise.resolve({ adapter: anthropicAdapter(server.baseUrl, { env: {} }) }),
      {
        code: 'provider_rejected',
        retryable: false,
        httpStatus: null,
        message:
          'The environment variable ANTHROPIC_API_KEY is not set. Set it, or enter the key in Settings.',
      },
    ],
  ];

describe('Anthropic errors', () => {
  it.each(cases)('PRV-013: %s', async (_name, arrange, expected) => {
    const { adapter, ...overrides } = await arrange();
    const sentThrough = adapter ?? anthropicAdapter(server.baseUrl);
    const error = errorOf(await generate(sentThrough, textRequest(overrides)));
    expect(error).toMatchObject(expected);
    expect(error.message).not.toContain(API_KEY);
  });

  it("PRV-013: a model that cannot turn thinking off gets Anthropic's explanation and the setting to change", async () => {
    const said =
      '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" ' +
      'and "output_config.effort" to control thinking behavior.';
    replyStatus(400, 'invalid_request_error', said);
    replyStatus(400, 'invalid_request_error', said);
    const adapter = anthropicAdapter(server.baseUrl);

    const off = textRequest({ profile: anthropicProfile({ thinking: 'off' }) });
    expect(errorOf(await generate(adapter, off))).toEqual({
      code: 'provider_rejected',
      message:
        `Anthropic rejected the request (HTTP 400): ${said} This profile turns thinking off, ` +
        'which some Anthropic models do not allow; if that is the problem, set the ' +
        "profile's thinking to provider-default in Settings.",
      retryable: false,
      httpStatus: 400,
    });
    expect(sentBody(server).thinking).toEqual({ type: 'disabled' });

    const providerDefault = errorOf(await generate(adapter, textRequest()));
    expect(providerDefault.message).toBe(`Anthropic rejected the request (HTTP 400): ${said}`);
  });

  it('PRV-040: a model that refuses forced tool use is provider_rejected, so the pipeline can fall back (PRV-053)', async () => {
    replyStatus(
      400,
      'invalid_request_error',
      'tool_choice: type "tool" and "any" are not supported for this model.',
    );
    const toolCall = textRequest({
      role: 'adjudicator',
      profile: anthropicProfile({ structuredOutput: 'tool-call' }),
      format: { type: 'json', schemaName: 'ruling', jsonSchema: { type: 'object' } },
    });
    expect(errorOf(await generate(anthropicAdapter(server.baseUrl), toolCall))).toMatchObject({
      code: 'provider_rejected',
      retryable: false,
      httpStatus: 400,
    });
  });
});
