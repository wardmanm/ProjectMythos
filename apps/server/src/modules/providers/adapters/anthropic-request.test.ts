import { type ChatMessage, type ModelProfile, ModelProfileSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import type { TextRequest } from '../types';
import { buildMessagesRequest, buildPrompt, MessagesRequestSchema } from './anthropic-request';

function profile(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return ModelProfileSchema.parse({
    id: 'opus',
    providerId: 'anthropic',
    model: 'claude-opus-5-5',
    kind: 'text',
    contextWindow: 200_000,
    maxOutputTokens: 4096,
    structuredOutput: 'json-schema',
    thinking: 'provider-default',
    ...overrides,
  });
}

const rulingSchema = {
  type: 'object',
  properties: { outcome: { type: 'string', enum: ['success', 'failure'] } },
  required: ['outcome'],
  additionalProperties: false,
};

function request(overrides: Partial<TextRequest> = {}): TextRequest {
  return {
    role: 'narrator',
    profile: profile(),
    messages: [
      { role: 'system', content: 'You are the GM.' },
      { role: 'user', content: 'I push the door open.' },
    ],
    format: { type: 'text' },
    maxOutputTokens: 512,
    sampling: { temperature: 0.7, topP: 0.9, topK: 40 },
    signal: new AbortController().signal,
    ...overrides,
  };
}

function jsonRequest(method: ModelProfile['structuredOutput']): TextRequest {
  return request({
    role: 'adjudicator',
    profile: profile({ structuredOutput: method }),
    format: { type: 'json', schemaName: 'ruling', jsonSchema: rulingSchema },
  });
}

const text = (content: string, breakpoint = false): ChatMessage =>
  breakpoint ? { role: 'user', content, cacheBreakpoint: true } : { role: 'user', content };

describe('buildMessagesRequest', () => {
  it('PRV-040: a text request streams, with system blocks and no sampling or format fields', () => {
    const body = buildMessagesRequest(request());
    expect(MessagesRequestSchema.parse(body)).toEqual(body);
    expect(body).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
        "messages": [
          {
            "content": [
              {
                "text": "I push the door open.",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ],
        "model": "claude-opus-5-5",
        "stream": true,
        "system": [
          {
            "text": "You are the GM.",
            "type": "text",
          },
        ],
      }
    `);
  });

  it('PRV-040: json-schema sends the schema unchanged as output_config.format', () => {
    const body = buildMessagesRequest(jsonRequest('json-schema'));
    expect(MessagesRequestSchema.parse(body)).toEqual(body);
    expect(body.output_config?.format.schema).toBe(rulingSchema);
    expect(body).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
        "messages": [
          {
            "content": [
              {
                "text": "I push the door open.",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ],
        "model": "claude-opus-5-5",
        "output_config": {
          "format": {
            "schema": {
              "additionalProperties": false,
              "properties": {
                "outcome": {
                  "enum": [
                    "success",
                    "failure",
                  ],
                  "type": "string",
                },
              },
              "required": [
                "outcome",
              ],
              "type": "object",
            },
            "type": "json_schema",
          },
        },
        "stream": true,
        "system": [
          {
            "text": "You are the GM.",
            "type": "text",
          },
        ],
      }
    `);
  });

  it('PRV-040: tool-call forces one strict tool named after the schema', () => {
    const body = buildMessagesRequest(jsonRequest('tool-call'));
    expect(MessagesRequestSchema.parse(body)).toEqual(body);
    expect(body).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
        "messages": [
          {
            "content": [
              {
                "text": "I push the door open.",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ],
        "model": "claude-opus-5-5",
        "stream": true,
        "system": [
          {
            "text": "You are the GM.",
            "type": "text",
          },
        ],
        "tool_choice": {
          "name": "ruling",
          "type": "tool",
        },
        "tools": [
          {
            "input_schema": {
              "additionalProperties": false,
              "properties": {
                "outcome": {
                  "enum": [
                    "success",
                    "failure",
                  ],
                  "type": "string",
                },
              },
              "required": [
                "outcome",
              ],
              "type": "object",
            },
            "name": "ruling",
            "strict": true,
          },
        ],
      }
    `);
  });

  it('PRV-040: prompt-only sends no format field, leaving the format to the prompt', () => {
    const body = buildMessagesRequest(jsonRequest('prompt-only'));
    expect(MessagesRequestSchema.parse(body)).toEqual(body);
    expect(body).toMatchInlineSnapshot(`
      {
        "max_tokens": 512,
        "messages": [
          {
            "content": [
              {
                "text": "I push the door open.",
                "type": "text",
              },
            ],
            "role": "user",
          },
        ],
        "model": "claude-opus-5-5",
        "stream": true,
        "system": [
          {
            "text": "You are the GM.",
            "type": "text",
          },
        ],
      }
    `);
  });

  it.each([
    ['off', { type: 'disabled' }],
    ['on', { type: 'adaptive', display: 'summarized' }],
    ['provider-default', undefined],
  ] as const)('PRV-046: thinking %s sends %j', (thinking, expected) => {
    const body = buildMessagesRequest(request({ profile: profile({ thinking }) }));
    expect(body.thinking).toEqual(expected);
    expect('thinking' in body).toBe(expected !== undefined);
  });
});

describe('buildPrompt', () => {
  it('PRV-043, CTX-011: consecutive same-role messages merge into one message, one block each, keeping their breakpoints', () => {
    const prompt = buildPrompt([
      { role: 'system', content: 'Rules.' },
      { role: 'system', content: 'World.', cacheBreakpoint: true },
      text('Scene.', true),
      text('Transcript.'),
      { role: 'assistant', content: '{"outcome":' },
      { role: 'assistant', content: '"maybe"}' },
      text('That is not valid.', true),
    ]);
    expect(prompt).toEqual({
      system: [
        { type: 'text', text: 'Rules.' },
        { type: 'text', text: 'World.', cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Scene.', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'Transcript.' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: '{"outcome":' },
            { type: 'text', text: '"maybe"}' },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'That is not valid.', cache_control: { type: 'ephemeral' } },
          ],
        },
      ],
    });
  });

  it('PRV-043, CTX-011: a message with no visible text is left out, and its breakpoint moves to the block before it', () => {
    const prompt = buildPrompt([
      { role: 'system', content: 'World.' },
      { role: 'user', content: '', cacheBreakpoint: true },
      text('Transcript.'),
      { role: 'user', content: ' \n ', cacheBreakpoint: true },
      text('This turn.'),
    ]);
    expect(prompt).toEqual({
      system: [{ type: 'text', text: 'World.', cache_control: { type: 'ephemeral' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Transcript.', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'This turn.' },
          ],
        },
      ],
    });
  });

  it('PRV-041: a breakpoint on an empty first message has no block to move to, and is dropped', () => {
    expect(buildPrompt([text('', true), text('Hello.')])).toEqual({
      system: [],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
    });
  });

  it('PRV-041: more than four cache breakpoints is a programmer error and throws (CONV-041)', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((content) => text(content, true));
    expect(() => buildPrompt(five.slice(0, 4))).not.toThrow();
    expect(() => buildPrompt(five)).toThrow('5 cache breakpoints');
  });

  it('PRV-043: a system message after the conversation began is a programmer error and throws (CONV-041)', () => {
    expect(() =>
      buildPrompt([text('Hello.'), { role: 'system', content: 'Late instructions.' }]),
    ).toThrow('Message 1 is a system message');
  });
});
