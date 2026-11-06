import { ok } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TextRequest } from '../types';
import { type FakeServer, ndjsonLine, startFakeServer } from './fake-server';
import {
  generateWith,
  ollamaAt,
  ollamaContentLine,
  ollamaDone,
  ollamaThinkingLine,
  testDeps,
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

const generate = (req: TextRequest) => generateWith(ollamaAt(server.baseUrl), req);

describe('createOllamaAdapter: the reply', () => {
  it('PRV-012: a reply that is not streamed becomes a TextResponse with the reported counts', async () => {
    server.reply('POST', '/api/chat', { type: 'json', body: ollamaDone('The door opens.') });
    expect(await generate(textRequest())).toEqual(
      ok({
        text: 'The door opens.',
        thinking: null,
        usage: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 100 },
        finishReason: 'stop',
      }),
    );
  });

  it('PRV-012: done_reason length is finishReason length', async () => {
    server.reply('POST', '/api/chat', {
      type: 'json',
      body: ollamaDone('The door', { done_reason: 'length' }),
    });
    const result = await generate(textRequest());
    expect(result.ok ? result.value.finishReason : null).toBe('length');
  });

  it('PRV-012: counts the reply leaves out are estimated from charsPerToken', async () => {
    server.reply('POST', '/api/chat', {
      type: 'json',
      body: { message: { role: 'assistant', content: 'Twelve chars' }, done: true },
    });
    const result = await generate(textRequest());
    expect(result.ok ? result.value.usage : null).toEqual({
      inputTokens: 8,
      outputTokens: 3,
      cachedInputTokens: null,
    });
  });

  it('PRV-045: each streamed piece of text goes to onDelta as it arrives', async () => {
    server.reply('POST', '/api/chat', {
      type: 'stream',
      chunks: [
        ollamaContentLine('The door '),
        { delayMs: 10, text: ollamaContentLine('opens.') },
        ndjsonLine(ollamaDone('')),
      ],
    });
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

  it('PRV-022, PRV-046: thinking from the thinking field is captured and never streamed', async () => {
    server.reply('POST', '/api/chat', {
      type: 'stream',
      chunks: [
        ollamaThinkingLine('Is it locked? '),
        ollamaThinkingLine('No.'),
        ollamaContentLine('It opens.'),
        ndjsonLine(ollamaDone('')),
      ],
    });
    const deltas: string[] = [];
    const result = await generate(textRequest({ onDelta: (delta) => deltas.push(delta) }));
    expect(deltas).toEqual(['It opens.']);
    expect(result.ok ? [result.value.text, result.value.thinking] : null).toEqual([
      'It opens.',
      'Is it locked? No.',
    ]);
  });

  it('PRV-046: a <think> block split across lines never reaches onDelta', async () => {
    server.reply('POST', '/api/chat', {
      type: 'stream',
      chunks: ['<thi', 'nk>weigh it</th', 'ink>\n\nThe lock ', 'gives.'].map(ollamaContentLine),
    });
    const deltas: string[] = [];
    const result = await generate(textRequest({ onDelta: (delta) => deltas.push(delta) }));
    expect(deltas.join('')).toBe('The lock gives.');
    for (const delta of deltas) expect(delta).not.toMatch(/[<>]/);
    expect(result.ok ? [result.value.text, result.value.thinking] : null).toEqual([
      'The lock gives.',
      'weigh it',
    ]);
  });

  it('PRV-046: a <think> block in a reply that is not streamed is thinking', async () => {
    server.reply('POST', '/api/chat', {
      type: 'json',
      body: ollamaDone('<think>\nweigh it\n</think>\n\nThe lock gives.'),
    });
    const result = await generate(textRequest());
    expect(result.ok ? [result.value.text, result.value.thinking] : null).toEqual([
      'The lock gives.',
      'weigh it',
    ]);
  });

  const toolCall = { function: { name: 'ruling', arguments: { outcome: 'success' } } };

  it('PRV-023: tool-call reads the answer from the tool call arguments', async () => {
    server.reply('POST', '/api/chat', {
      type: 'json',
      body: ollamaDone('', { message: { role: 'assistant', content: '', tool_calls: [toolCall] } }),
    });
    const result = await generate(toolRequest());
    expect(result.ok ? result.value.text : null).toBe('{"outcome":"success"}');
  });

  it('PRV-023, PRV-045: a streamed tool call is the answer and goes to onDelta', async () => {
    server.reply('POST', '/api/chat', {
      type: 'stream',
      chunks: [
        ndjsonLine({
          message: { role: 'assistant', content: '', tool_calls: [toolCall] },
          done: false,
        }),
        ndjsonLine(ollamaDone('')),
      ],
    });
    const deltas: string[] = [];
    const result = await generate(toolRequest((delta) => deltas.push(delta)));
    expect(deltas).toEqual(['{"outcome":"success"}']);
    expect(result.ok ? result.value.text : null).toBe('{"outcome":"success"}');
  });

  it('PRV-023: tool-call uses the plain-text answer when the model calls no tool', async () => {
    server.reply('POST', '/api/chat', { type: 'json', body: ollamaDone('{"outcome":"partial"}') });
    const result = await generate(toolRequest());
    expect(result.ok ? result.value.text : null).toBe('{"outcome":"partial"}');
  });
});

describe('createOllamaAdapter: listModels and health', () => {
  it('PRV-091: listModels lists the model names from /api/tags', async () => {
    server.reply('GET', '/api/tags', {
      type: 'json',
      body: { models: [{ name: 'qwen3.6:35b-a3b', size: 1 }, { name: 'nomic-embed-text' }] },
    });
    expect(await ollamaAt(server.baseUrl).listModels(new AbortController().signal)).toEqual(
      ok(['qwen3.6:35b-a3b', 'nomic-embed-text']),
    );
  });

  it('PRV-091: health reports the version and the round trip time', async () => {
    server.reply('GET', '/api/version', { type: 'json', body: { version: '0.40.14' } });
    const times = [1000, 1042];
    const deps = { ...testDeps, timeSource: { now: () => times.shift() ?? 0 } };
    expect(await ollamaAt(server.baseUrl, deps).health(new AbortController().signal)).toEqual({
      reachable: true,
      latencyMs: 42,
      detail: `Ollama 0.40.14 is running at ${server.baseUrl}.`,
    });
  });

  it('PRV-091: health reports an unreachable server in plain words', async () => {
    server.reply('GET', '/api/version', { type: 'destroy' });
    expect(await ollamaAt(server.baseUrl).health(new AbortController().signal)).toEqual({
      reachable: false,
      latencyMs: null,
      detail: `The connection to Ollama at ${server.baseUrl} closed unexpectedly.`,
    });
  });
});
