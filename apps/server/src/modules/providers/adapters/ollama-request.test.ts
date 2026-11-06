import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { TextRequest } from '../types';
import { type FakeServer, ndjsonLine, startFakeServer } from './fake-server';
import {
  generateWith,
  ollamaAt,
  ollamaDone,
  rulingFormat,
  testProfile,
  textRequest,
} from './testing';

let server: FakeServer;
beforeEach(async () => {
  server = await startFakeServer();
});
afterEach(async () => {
  await server.close();
});

const generate = (req: TextRequest) => generateWith(ollamaAt(server.baseUrl), req);

/** Sends `req` against one scripted reply and returns the body the adapter sent. */
async function sentBody(req: TextRequest): Promise<unknown> {
  server.reply('POST', '/api/chat', { type: 'json', body: ollamaDone('{"outcome":"ok"}') });
  await generate(req);
  return server.requests.at(-1)?.body;
}

describe('createOllamaAdapter: the request', () => {
  it('PRV-020, PRV-021: sends the context size, keep-alive, output limit, and sampling', async () => {
    const req = textRequest({ sampling: { temperature: 0.7, topK: 40, presencePenalty: 1.5 } });
    expect(await sentBody(req)).toMatchInlineSnapshot(`
      {
        "keep_alive": "30m",
        "messages": [
          {
            "content": "You are the GM.",
            "role": "system",
          },
          {
            "content": "I knock twice.",
            "role": "user",
          },
        ],
        "model": "qwen3.6:35b-a3b",
        "options": {
          "num_ctx": 32768,
          "num_predict": 512,
          "presence_penalty": 1.5,
          "temperature": 0.7,
          "top_k": 40,
        },
        "stream": false,
        "think": false,
      }
    `);
    expect(server.requests[0]?.path).toBe('/api/chat');
  });

  it('PRV-023: json-schema sets format to the JSON Schema', async () => {
    expect(await sentBody(textRequest({ format: rulingFormat }))).toMatchInlineSnapshot(`
      {
        "format": {
          "additionalProperties": false,
          "properties": {
            "outcome": {
              "type": "string",
            },
          },
          "required": [
            "outcome",
          ],
          "type": "object",
        },
        "keep_alive": "30m",
        "messages": [
          {
            "content": "You are the GM.",
            "role": "system",
          },
          {
            "content": "I knock twice.",
            "role": "user",
          },
        ],
        "model": "qwen3.6:35b-a3b",
        "options": {
          "num_ctx": 32768,
          "num_predict": 512,
        },
        "stream": false,
        "think": false,
      }
    `);
  });

  it('PRV-023: tool-call offers one tool with the schema as its parameters', async () => {
    const req = textRequest({
      format: rulingFormat,
      profile: testProfile({ structuredOutput: 'tool-call' }),
    });
    expect(await sentBody(req)).toMatchInlineSnapshot(`
      {
        "keep_alive": "30m",
        "messages": [
          {
            "content": "You are the GM.",
            "role": "system",
          },
          {
            "content": "I knock twice.",
            "role": "user",
          },
        ],
        "model": "qwen3.6:35b-a3b",
        "options": {
          "num_ctx": 32768,
          "num_predict": 512,
        },
        "stream": false,
        "think": false,
        "tools": [
          {
            "function": {
              "name": "ruling",
              "parameters": {
                "additionalProperties": false,
                "properties": {
                  "outcome": {
                    "type": "string",
                  },
                },
                "required": [
                  "outcome",
                ],
                "type": "object",
              },
            },
            "type": "function",
          },
        ],
      }
    `);
  });

  it('PRV-023: prompt-only sends no format and no tools', async () => {
    const req = textRequest({
      format: rulingFormat,
      profile: testProfile({ structuredOutput: 'prompt-only' }),
    });
    expect(await sentBody(req)).toMatchInlineSnapshot(`
      {
        "keep_alive": "30m",
        "messages": [
          {
            "content": "You are the GM.",
            "role": "system",
          },
          {
            "content": "I knock twice.",
            "role": "user",
          },
        ],
        "model": "qwen3.6:35b-a3b",
        "options": {
          "num_ctx": 32768,
          "num_predict": 512,
        },
        "stream": false,
        "think": false,
      }
    `);
  });

  it('PRV-022: thinking on and off set think, and provider-default leaves it out', async () => {
    const think = async (thinking: 'on' | 'off' | 'provider-default') => {
      const body = await sentBody(textRequest({ profile: testProfile({ thinking }) }));
      return typeof body === 'object' && body !== null && 'think' in body ? body.think : 'absent';
    };
    expect({
      on: await think('on'),
      off: await think('off'),
      'provider-default': await think('provider-default'),
    }).toMatchInlineSnapshot(`
      {
        "off": false,
        "on": true,
        "provider-default": "absent",
      }
    `);
  });

  it('PRV-045: a call with onDelta streams, and one without does not', async () => {
    server.reply('POST', '/api/chat', { type: 'stream', chunks: [ndjsonLine(ollamaDone('Hi.'))] });
    await generate(textRequest({ onDelta: () => undefined }));
    await sentBody(textRequest());
    const StreamSchema = z.object({ stream: z.boolean() });
    expect(server.requests.map((sent) => StreamSchema.parse(sent.body).stream)).toEqual([
      true,
      false,
    ]);
  });
});
