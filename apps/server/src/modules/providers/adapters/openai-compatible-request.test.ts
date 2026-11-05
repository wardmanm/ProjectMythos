import { err } from '@mythos/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TextRequest } from '../types';
import { type FakeServer, startFakeServer } from './fake-server';
import {
  generateWith,
  openAiCompatibleAt,
  openAiCompletion,
  openAiStream,
  rulingFormat,
  testProfile,
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

/** Sends `req` against one scripted reply and returns the body the adapter sent. */
async function sentBody(req: TextRequest): Promise<unknown> {
  server.reply('POST', '/v1/chat/completions', openAiCompletion({ content: '{"outcome":"ok"}' }));
  await generate(req);
  return server.requests.at(-1)?.body;
}

describe('createOpenAiCompatibleAdapter: the request', () => {
  it('PRV-030: a text request sends no format, with the key as a bearer token', async () => {
    server.reply('POST', '/v1/chat/completions', openAiCompletion({ content: 'Hi.' }));
    await generate(textRequest({ sampling: { temperature: 0.7, topP: 0.9 } }), {
      apiKey: { env: 'LOCAL_KEY' },
      headers: { 'X-Title': 'Mythos', Authorization: 'replaced' },
    });
    const [sent] = server.requests;
    expect(sent?.path).toBe('/v1/chat/completions');
    expect([sent?.headers.authorization, sent?.headers['x-title']]).toEqual([
      'Bearer sk-local-123',
      'Mythos',
    ]);
    expect(sent?.body).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
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
        "stream": false,
        "temperature": 0.7,
        "top_p": 0.9,
      }
    `);
  });

  it('PRV-030: json-schema sends response_format with the schema, strict', async () => {
    expect(await sentBody(textRequest({ format: rulingFormat }))).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
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
        "response_format": {
          "json_schema": {
            "name": "ruling",
            "schema": {
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
            "strict": true,
          },
          "type": "json_schema",
        },
        "stream": false,
      }
    `);
  });

  it('PRV-030: tool-call sends one tool with the schema and forces it with tool_choice', async () => {
    expect(await sentBody(toolRequest())).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
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
        "stream": false,
        "tool_choice": {
          "function": {
            "name": "ruling",
          },
          "type": "function",
        },
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

  it('PRV-030: prompt-only sends no format parameter', async () => {
    const req = textRequest({
      format: rulingFormat,
      profile: testProfile({ structuredOutput: 'prompt-only' }),
    });
    expect(await sentBody(req)).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
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
        "stream": false,
      }
    `);
  });

  it('PRV-030, PRV-045: a streamed call asks for usage, and sends top_k and repeat_penalty when set', async () => {
    server.reply('POST', '/v1/chat/completions', openAiStream([{ content: 'Hi.' }]));
    const sampling = { topK: 40, repeatPenalty: 1.1 };
    await generate(textRequest({ sampling, onDelta: () => undefined }));
    expect(server.requests[0]?.body).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
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
        "repeat_penalty": 1.1,
        "stream": true,
        "stream_options": {
          "include_usage": true,
        },
        "top_k": 40,
      }
    `);
  });

  it('PRV-030: no API key sends no authorization header', async () => {
    await sentBody(textRequest());
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('PRV-013: a missing API-key variable is provider_rejected, and nothing is sent', async () => {
    const result = await generate(textRequest(), { apiKey: { env: 'MISSING_KEY' } });
    expect(result).toEqual(
      err({
        code: 'provider_rejected',
        message:
          'The environment variable MISSING_KEY is not set. Set it, or enter the key in Settings.',
        retryable: false,
        httpStatus: null,
      }),
    );
    expect(server.requests).toEqual([]);
  });

  it('PRV-013, CONV-072: the API key never appears in an error', async () => {
    server.reply('POST', '/v1/chat/completions', {
      type: 'json',
      status: 401,
      body: { error: { message: 'Incorrect API key provided: sk-local-123' } },
    });
    const result = await generate(textRequest(), { apiKey: { value: 'sk-local-123' } });
    expect(result.ok ? null : result.error.message).toBe(
      'lm-studio (OpenAI-compatible) rejected the request (HTTP 401): ' +
        'Incorrect API key provided: [redacted]',
    );
  });
});
