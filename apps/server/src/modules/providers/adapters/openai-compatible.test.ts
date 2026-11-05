import { err, ok } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TextRequest } from '../types';
import { type FakeServer, sseEvent, startFakeServer } from './fake-server';
import {
  generateWith,
  openAiCompatibleAt,
  openAiCompletion,
  openAiStream,
  textRequest,
  toolRequest,
} from './testing';

let server: FakeServer;
beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  await server.close();
});

async function generate(req: TextRequest, extra: Record<string, unknown> = {}) {
  return generateWith(openAiCompatibleAt(server.baseUrl, extra), req);
}

describe('createOpenAiCompatibleAdapter: the reply', () => {
  it('PRV-012: a reply that is not streamed becomes a TextResponse with the reported usage', async () => {
    server.reply('POST', '/v1/chat/completions', openAiCompletion({ content: 'The door opens.' }));
    expect(await generate(textRequest())).toEqual(
      ok({
        text: 'The door opens.',
        thinking: null,
        usage: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 100 },
        finishReason: 'stop',
      }),
    );
  });

  it('PRV-012: usage the reply leaves out is estimated, and length is finishReason length', async () => {
    server.reply('POST', '/v1/chat/completions', {
      type: 'json',
      body: { choices: [{ message: { content: 'Twelve chars' }, finish_reason: 'length' }] },
    });
    expect(await generate(textRequest())).toEqual(
      ok({
        text: 'Twelve chars',
        thinking: null,
        usage: { inputTokens: 8, outputTokens: 3, cachedInputTokens: null },
        finishReason: 'length',
      }),
    );
  });

  it('PRV-045: each streamed piece of text goes to onDelta, and usage comes from the last chunk', async () => {
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiStream([{ role: 'assistant', content: 'The door ' }, { content: 'opens.' }]),
    );
    const deltas: string[] = [];
    const result = await generate(textRequest({ onDelta: (delta) => deltas.push(delta) }));
    expect(deltas).toEqual(['The door ', 'opens.']);
    expect(result).toEqual(
      ok({
        text: 'The door opens.',
        thinking: null,
        usage: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 100 },
        finishReason: 'stop',
      }),
    );
  });

  const reasoningForms: [form: string, message: (reasoning: string) => Record<string, unknown>][] =
    [
      ['reasoning_content', (reasoning) => ({ reasoning_content: reasoning })],
      ['reasoning', (reasoning) => ({ reasoning })],
      ['inline <think> tags', (reasoning) => ({ content: `<think>${reasoning}</think>` })],
    ];

  it.each(reasoningForms)(
    'PRV-046: reasoning in %s is thinking, never answer text, when streamed',
    async (_form, message) => {
      server.reply(
        'POST',
        '/v1/chat/completions',
        openAiStream([message('Is it '), message('locked?'), { content: '\n\nIt opens.' }]),
      );
      const deltas: string[] = [];
      const result = await generate(textRequest({ onDelta: (delta) => deltas.push(delta) }));
      for (const delta of deltas) expect(delta).not.toMatch(/locked|<|>/);
      expect(result.ok ? [result.value.text.trim(), result.value.thinking] : null).toEqual([
        'It opens.',
        'Is it locked?',
      ]);
    },
  );

  it.each(reasoningForms)(
    'PRV-046: reasoning in %s is thinking, never answer text, when not streamed',
    async (_form, message) => {
      const reply = message('Is it locked?');
      const content = typeof reply.content === 'string' ? reply.content : '';
      server.reply(
        'POST',
        '/v1/chat/completions',
        openAiCompletion({ ...reply, content: `${content}It opens.` }),
      );
      const result = await generate(textRequest());
      expect(result.ok ? [result.value.text, result.value.thinking] : null).toEqual([
        'It opens.',
        'Is it locked?',
      ]);
    },
  );

  it('PRV-030: tool-call reads the answer from the tool call arguments', async () => {
    const toolCalls = [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'ruling', arguments: '{"outcome":"success"}' },
      },
    ];
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiCompletion({ content: null, tool_calls: toolCalls }, 'tool_calls'),
    );
    expect(await generate(toolRequest())).toMatchObject(
      ok({ text: '{"outcome":"success"}', finishReason: 'stop' }),
    );
  });

  it('PRV-030, PRV-045: streamed tool-call arguments are joined, and each piece goes to onDelta', async () => {
    const piece = (index: number, args: string) => ({
      tool_calls: [{ index, function: { arguments: args } }],
    });
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiStream(
        [piece(0, '{"outcome"'), piece(0, ':"success"}'), piece(1, '{"ignored":true}')],
        'tool_calls',
      ),
    );
    const deltas: string[] = [];
    const result = await generate(toolRequest((delta) => deltas.push(delta)));
    expect(deltas).toEqual(['{"outcome"', ':"success"}']);
    expect(result.ok ? result.value.text : null).toBe('{"outcome":"success"}');
  });

  it('PRV-030: tool-call uses the content when the server calls no tool', async () => {
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiCompletion({ content: '{"outcome":"partial"}' }),
    );
    const result = await generate(toolRequest());
    expect(result.ok ? result.value.text : null).toBe('{"outcome":"partial"}');
  });

  it('PRV-013: a refusal in a 200 reply is ok with finishReason refusal, in its own words', async () => {
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiCompletion({ content: null, refusal: 'I cannot help with that.' }),
    );
    expect(await generate(textRequest())).toMatchObject(
      ok({ text: 'I cannot help with that.', finishReason: 'refusal' }),
    );
  });

  it('PRV-013: a streamed refusal never reaches onDelta', async () => {
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiStream([{ refusal: 'I cannot ' }, { refusal: 'help.' }]),
    );
    const deltas: string[] = [];
    const result = await generate(textRequest({ onDelta: (delta) => deltas.push(delta) }));
    expect(deltas).toEqual([]);
    expect(result).toMatchObject(ok({ text: 'I cannot help.', finishReason: 'refusal' }));
  });

  it('PRV-013: finish_reason content_filter is finishReason refusal', async () => {
    server.reply(
      'POST',
      '/v1/chat/completions',
      openAiStream([{ content: 'The' }], 'content_filter'),
    );
    const result = await generate(textRequest({ onDelta: () => undefined }));
    expect(result).toMatchObject(ok({ text: 'The', finishReason: 'refusal' }));
  });

  it('PRV-013: an SSE error event is provider_unavailable', async () => {
    server.reply('POST', '/v1/chat/completions', {
      type: 'stream',
      chunks: [sseEvent({ message: 'Model unloaded.' }, 'error')],
    });
    expect(await generate(textRequest({ onDelta: () => undefined }))).toEqual(
      err({
        code: 'provider_unavailable',
        message: 'lm-studio (OpenAI-compatible) stopped with an error: Model unloaded.',
        retryable: true,
        httpStatus: null,
      }),
    );
  });

  it('PRV-013: a reply with an error and no choices, sent with a 200, is provider_unavailable', async () => {
    server.reply(
      'POST',
      '/v1/chat/completions',
      { type: 'json', body: { error: { message: 'Context overflow.' } } },
      { type: 'json', body: { choices: [] } },
    );
    const results = [await generate(textRequest()), await generate(textRequest())];
    expect(results.map((result) => (result.ok ? null : result.error.message))).toEqual([
      'lm-studio (OpenAI-compatible) stopped with an error: Context overflow.',
      'lm-studio (OpenAI-compatible) sent a reply with no answer in it.',
    ]);
  });
});

describe('createOpenAiCompatibleAdapter: listModels and health', () => {
  it('PRV-091: listModels lists the model ids from /models', async () => {
    server.reply('GET', '/v1/models', {
      type: 'json',
      body: { object: 'list', data: [{ id: 'qwen3.6-35b', object: 'model' }, { id: 'gemma-4' }] },
    });
    expect(
      await openAiCompatibleAt(server.baseUrl).listModels(new AbortController().signal),
    ).toEqual(ok(['qwen3.6-35b', 'gemma-4']));
  });

  it('PRV-091: health reports the server and how many models it has', async () => {
    server.reply('GET', '/v1/models', { type: 'json', body: { data: [{ id: 'qwen3.6-35b' }] } });
    expect(await openAiCompatibleAt(server.baseUrl).health(new AbortController().signal)).toEqual({
      reachable: true,
      latencyMs: 0,
      detail: `lm-studio (OpenAI-compatible) is running at ${server.baseUrl}, with 1 model.`,
    });
  });

  it('PRV-091: health reports a rejected key in plain words', async () => {
    server.reply('GET', '/v1/models', {
      type: 'json',
      status: 401,
      body: { error: { message: 'Bad key.' } },
    });
    expect(
      await openAiCompatibleAt(server.baseUrl, { apiKey: { value: 'sk-x' } }).health(
        new AbortController().signal,
      ),
    ).toEqual({
      reachable: false,
      latencyMs: null,
      detail: 'lm-studio (OpenAI-compatible) rejected the request (HTTP 401): Bad key.',
    });
    expect(server.requests[0]?.headers.authorization).toBe('Bearer sk-x');
  });
});
