import type { ModelProfile } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAdapter } from '../registry';
import type { TextRequest } from '../types';
import {
  anthropicAdapter,
  anthropicConfig,
  anthropicProfile,
  API_KEY,
  blockStart,
  blockStop,
  delta,
  errorOf,
  generate,
  messageDelta,
  messageStart,
  messageStop,
  replyStream,
  sentBody,
  textDelta,
  textRequest,
  textStream,
  valueOf,
} from './anthropic-testing';
import { type FakeServer, startFakeServer } from './fake-server';

let server: FakeServer;
beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  await server.close();
});

/** Generates through an adapter for the fake server. */
function call(req: TextRequest = textRequest()) {
  return generate(anthropicAdapter(server.baseUrl), req);
}

describe('the Anthropic adapter', () => {
  it('PRV-010: createAdapter builds it with a text member and no embedding member', () => {
    const config = anthropicConfig(server.baseUrl);
    const built = createAdapter(config, { env: {}, timeSource: { now: () => 0 } });
    expect(built.config).toBe(config);
    expect(typeof built.text?.generate).toBe('function');
    expect(built.embedding).toBeUndefined();
  });

  it('PRV-011: generate POSTs to /v1/messages with the API key, version, and content type', async () => {
    replyStream(server, textStream(['Hello.']));
    valueOf(await call());
    const [sent] = server.requests;
    expect(sent?.method).toBe('POST');
    expect(sent?.path).toBe('/v1/messages');
    expect(sent?.headers['x-api-key']).toBe(API_KEY);
    expect(sent?.headers['anthropic-version']).toBe('2026-10-21');
    expect(sent?.headers['content-type']).toBe('application/json');
    expect(sent?.headers.authorization).toBeUndefined();
  });

  it('PRV-012: a streamed message becomes a TextResponse', async () => {
    replyStream(server, textStream(['The door ', 'creaks open.']));
    expect(valueOf(await call())).toEqual({
      text: 'The door creaks open.',
      thinking: null,
      usage: { inputTokens: 25, outputTokens: 9, cachedInputTokens: null },
      finishReason: 'stop',
    });
  });

  it('PRV-012, CSET-050: a refusal is a response with finishReason refusal, not an error', async () => {
    replyStream(server, textStream(['I will not write that.'], 'refusal'));
    expect(valueOf(await call())).toMatchObject({
      text: 'I will not write that.',
      finishReason: 'refusal',
    });
  });

  it('PRV-012: listModels follows after_id page by page, keeping the API order', async () => {
    const page = (ids: string[], hasMore: boolean) => ({
      type: 'json' as const,
      body: {
        data: ids.map((id) => ({ id })),
        has_more: hasMore,
        first_id: ids[0],
        last_id: ids.at(-1),
      },
    });
    server.reply(
      'GET',
      '/v1/models',
      page(['claude-opus-5-5', 'claude-sonnet-5-5'], true),
      page(['claude-haiku-5-5'], false),
    );
    const listed = await anthropicAdapter(server.baseUrl).listModels(new AbortController().signal);
    expect(listed).toEqual({
      ok: true,
      value: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
    });
    expect(server.requests.map((sent) => sent.path)).toEqual([
      '/v1/models?limit=1000',
      '/v1/models?limit=1000&after_id=claude-sonnet-5-5',
    ]);
    expect(server.requests[0]?.headers['x-api-key']).toBe(API_KEY);
  });

  it('PRV-012: health lists one model and reports the latency measured with the TimeSource', async () => {
    server.reply('GET', '/v1/models', {
      type: 'json',
      body: { data: [{ id: 'claude-opus-5-5' }], has_more: true, last_id: 'claude-opus-5-5' },
    });
    const readings = [1000, 1250];
    const timeSource = { now: () => readings.shift() ?? 9999 };
    const health = await anthropicAdapter(server.baseUrl, { timeSource }).health(
      new AbortController().signal,
    );
    expect(health).toEqual({
      reachable: true,
      latencyMs: 250,
      detail: 'Anthropic is reachable and accepted the API key.',
    });
    expect(server.requests[0]?.path).toBe('/v1/models?limit=1');
  });

  it('PRV-012: health with a key Anthropic refuses is not reachable, and says to check the key', async () => {
    server.reply('GET', '/v1/models', {
      type: 'json',
      status: 401,
      body: {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      },
    });
    expect(await anthropicAdapter(server.baseUrl).health(new AbortController().signal)).toEqual({
      reachable: false,
      latencyMs: null,
      detail:
        'Anthropic rejected the request (HTTP 401): invalid x-api-key. Check the API key in Settings.',
    });
  });
});

describe('Anthropic structured output', () => {
  const schema = {
    type: 'object',
    properties: { outcome: { type: 'string' } },
    required: ['outcome'],
    additionalProperties: false,
  };
  const json = (method: ModelProfile['structuredOutput']): TextRequest =>
    textRequest({
      role: 'adjudicator',
      profile: anthropicProfile({ structuredOutput: method }),
      format: { type: 'json', schemaName: 'ruling', jsonSchema: schema },
    });

  it('PRV-040: json-schema sends output_config.format with the schema unchanged, and reads the text block', async () => {
    replyStream(server, textStream(['{"outcome":', '"success"}']));
    expect(valueOf(await call(json('json-schema'))).text).toBe('{"outcome":"success"}');
    expect(sentBody(server).output_config).toEqual({ format: { type: 'json_schema', schema } });
  });

  it('PRV-040: tool-call reads the forced tool input as the answer', async () => {
    replyStream(server, [
      messageStart(),
      blockStart(0, { type: 'tool_use', id: 'toolu_1', name: 'ruling', input: {} }),
      delta(0, { type: 'input_json_delta', partial_json: '' }),
      delta(0, { type: 'input_json_delta', partial_json: '{"outcome": ' }),
      delta(0, { type: 'input_json_delta', partial_json: '"failure"}' }),
      blockStop(0),
      messageDelta('tool_use'),
      messageStop(),
    ]);
    expect(valueOf(await call(json('tool-call')))).toMatchObject({
      text: '{"outcome": "failure"}',
      finishReason: 'stop',
    });
    expect(sentBody(server).tool_choice).toEqual({ type: 'tool', name: 'ruling' });
  });
});

describe('Anthropic prompts, streaming, thinking, and aborts', () => {
  it('PRV-041, CTX-011: a three-tier prompt gets cache_control exactly where CTX-010 puts it, and nowhere else', async () => {
    replyStream(server, textStream(['Hello.']));
    const messages: TextRequest['messages'] = [
      { role: 'system', content: 'Instructions tier.' },
      { role: 'system', content: 'World tier.', cacheBreakpoint: true },
      { role: 'user', content: 'Scene tier.', cacheBreakpoint: true },
      { role: 'user', content: 'Transcript tier.', cacheBreakpoint: true },
      { role: 'user', content: 'State, knowledge, turn, and task tiers.' },
    ];
    valueOf(await call(textRequest({ messages })));

    const body = sentBody(server);
    const ephemeral = { type: 'ephemeral' };
    expect(body.system).toEqual([
      { type: 'text', text: 'Instructions tier.' },
      { type: 'text', text: 'World tier.', cache_control: ephemeral },
    ]);
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Scene tier.', cache_control: ephemeral },
          { type: 'text', text: 'Transcript tier.', cache_control: ephemeral },
          { type: 'text', text: 'State, knowledge, turn, and task tiers.' },
        ],
      },
    ]);
    expect(JSON.stringify(body).split('cache_control').length - 1).toBe(3);
  });

  it('PRV-045: every text delta reaches onDelta in order, as it arrives', async () => {
    const parts = ['The ', 'lamp ', 'gutters', '.'];
    replyStream(server, [
      messageStart(),
      blockStart(0, { type: 'text', text: '' }),
      ...parts.map((part) => ({ delayMs: 10, text: textDelta(0, part) })),
      blockStop(0),
      messageDelta('end_turn'),
      messageStop(),
    ]);
    const deltas: string[] = [];
    const response = valueOf(await call(textRequest({ onDelta: (text) => deltas.push(text) })));
    expect(deltas).toEqual(parts);
    expect(response.text).toBe('The lamp gutters.');
  });

  it('PRV-045: without onDelta, the stream is still read whole and nothing is forwarded', async () => {
    replyStream(server, textStream(['Quiet ', 'call.']));
    expect(valueOf(await call()).text).toBe('Quiet call.');
  });

  it('PRV-046: thinking goes to thinking, never to onDelta, and usage includes cached tokens', async () => {
    replyStream(server, [
      messageStart({
        input_tokens: 10,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 300,
        output_tokens: 1,
      }),
      blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
      delta(0, { type: 'thinking_delta', thinking: 'The guard is ' }),
      delta(0, { type: 'thinking_delta', thinking: 'distracted.' }),
      delta(0, { type: 'signature_delta', signature: 'EqQBCgIYAhIM' }),
      blockStop(0),
      blockStart(1, { type: 'redacted_thinking', data: 'EmwKAhgB' }),
      blockStop(1),
      blockStart(2, { type: 'text', text: '' }),
      textDelta(2, 'You slip past.'),
      blockStop(2),
      messageDelta('end_turn', { output_tokens: 42 }),
      messageStop(),
    ]);
    const deltas: string[] = [];
    const req = textRequest({
      profile: anthropicProfile({ thinking: 'on' }),
      onDelta: (text) => deltas.push(text),
    });
    expect(valueOf(await call(req))).toEqual({
      text: 'You slip past.',
      thinking: 'The guard is distracted.',
      usage: { inputTokens: 2310, outputTokens: 42, cachedInputTokens: 2000 },
      finishReason: 'stop',
    });
    expect(deltas).toEqual(['You slip past.']);
    expect(sentBody(server).thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });

  it('PRV-046: an empty thinking block, as a model streams one by default, is no thinking', async () => {
    replyStream(server, [
      messageStart(),
      blockStart(0, { type: 'thinking', thinking: '', signature: '' }),
      delta(0, { type: 'thinking_delta', thinking: '' }),
      delta(0, { type: 'signature_delta', signature: 'EqQB' }),
      blockStop(0),
      ...textStream(['Done.']).slice(1),
    ]);
    expect(valueOf(await call()).thinking).toBeNull();
  });

  it('PRV-047: an abort after text returns that text as ok, with finishReason cancelled', async () => {
    replyStream(
      server,
      [
        messageStart({ input_tokens: 30, output_tokens: 1 }),
        blockStart(0, { type: 'text', text: '' }),
        textDelta(0, 'Once upon'),
      ],
      'hang',
    );
    const caller = new AbortController();
    const req = textRequest({
      signal: caller.signal,
      onDelta: () => {
        caller.abort();
      },
    });
    expect(valueOf(await call(req))).toEqual({
      text: 'Once upon',
      thinking: null,
      // No message_delta arrived: 9 characters at 4 per token.
      usage: { inputTokens: 30, outputTokens: 3, cachedInputTokens: null },
      finishReason: 'cancelled',
    });
  });

  it('PRV-047: an abort before any text is the cancelled error', async () => {
    replyStream(server, [messageStart()], 'hang');
    const caller = new AbortController();
    setTimeout(() => {
      caller.abort();
    }, 30);
    expect(errorOf(await call(textRequest({ signal: caller.signal })))).toEqual({
      code: 'cancelled',
      message: 'The call to Anthropic was cancelled.',
      retryable: false,
      httpStatus: null,
    });
  });
});
