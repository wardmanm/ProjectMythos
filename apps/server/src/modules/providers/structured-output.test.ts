import type { ChatMessage } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toJsonSchema } from './schema-adapt';
import {
  checkOutput,
  extractJson,
  formatInstruction,
  retryMessages,
  withFormatInstruction,
} from './structured-output';

const NoteSchema = z.strictObject({
  title: z.string().min(1),
  count: z.int().min(2),
  tags: z.array(z.string()).min(1),
  mode: z.enum(['brief', 'full']),
  aside: z.string().optional(),
});

describe('extractJson', () => {
  it('PRV-050: strips a code fence and the prose around it', () => {
    const text =
      'Here is my answer:\n```json\n{"title": "Rain", "count": 3}\n```\nHope that helps!';
    expect(extractJson(text)).toEqual({ ok: true, value: { title: 'Rain', count: 3 } });
  });

  it('PRV-050: repairs JSON that fails to parse with jsonrepair', () => {
    expect(extractJson('{"title": "Rain", "tags": ["a", "b",],}')).toEqual({
      ok: true,
      value: { title: 'Rain', tags: ['a', 'b'] },
    });
  });

  it('PRV-050: an answer cut off mid-object is repaired from the first brace to the end', () => {
    expect(extractJson('{"title": "Rain", "tags": ["a"')).toEqual({
      ok: true,
      value: { title: 'Rain', tags: ['a'] },
    });
  });

  it('PRV-050: an answer with no object, or beyond repair, is a parse error', () => {
    expect(extractJson('I cannot answer that.')).toEqual({
      ok: false,
      error: 'The answer holds no JSON object.',
    });
    const broken = extractJson('{"title": "Rain" : "Snow"}');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toMatch(/^The answer is not valid JSON: /);
  });
});

describe('checkOutput', () => {
  const valid = '{"title": "Rain", "count": 2, "tags": ["x"], "mode": "brief"}';

  it('PRV-050: a valid answer parses with the schema', () => {
    const checked = checkOutput(valid, NoteSchema, undefined);
    expect(checked).toEqual({
      ok: true,
      value: { title: 'Rain', count: 2, tags: ['x'], mode: 'brief' },
    });
  });

  it('PRV-050: Zod issues are listed by path', () => {
    const checked = checkOutput(
      '{"title": "", "count": 1, "tags": [], "mode": "x"}',
      NoteSchema,
      undefined,
    );
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    expect(checked.error.parseError).toBeNull();
    expect(checked.error.schemaIssues.map((issue) => issue.split(':')[0])).toEqual([
      'title',
      'count',
      'tags',
      'mode',
    ]);
  });

  it('CONV-032: output that fails semanticCheck is not returned', () => {
    const checked = checkOutput(valid, NoteSchema, (note) =>
      note.count < 5 ? [{ path: 'count', message: 'needs at least five' }] : [],
    );
    expect(checked).toEqual({
      ok: false,
      error: {
        parseError: null,
        schemaIssues: [],
        semanticIssues: [{ path: 'count', message: 'needs at least five' }],
      },
    });
  });
});

describe('formatInstruction', () => {
  const jsonSchema = toJsonSchema(NoteSchema);

  it('PRV-050: json-schema and tool-call get a one-line reminder', () => {
    for (const method of ['json-schema', 'tool-call'] as const) {
      const instruction = formatInstruction(method, 'note', jsonSchema);
      expect(instruction).toBe('Answer with a single JSON object for "note", and nothing else.');
    }
  });

  it('PRV-050: prompt-only gets the schema and a minimal example of its shape', () => {
    const lines = formatInstruction('prompt-only', 'note', jsonSchema).split('\n');
    expect(lines[2]).toBe(JSON.stringify(jsonSchema));
    const example: unknown = JSON.parse(lines[4] ?? '');
    expect(example).toEqual({ title: '...', count: 2, tags: ['...'], mode: 'brief' });
    expect(NoteSchema.safeParse(example).success).toBe(true);
  });
});

describe('withFormatInstruction', () => {
  it('PRV-050: adds a system message right after the leading system messages', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'instructions' },
      { role: 'system', content: 'world', cacheBreakpoint: true },
      { role: 'user', content: 'scene', cacheBreakpoint: true },
      { role: 'user', content: 'task' },
    ];
    expect(withFormatInstruction(messages, 'FORMAT').map((message) => message.content)).toEqual([
      'instructions',
      'world',
      'FORMAT',
      'scene',
      'task',
    ]);
    expect(withFormatInstruction([{ role: 'user', content: 'task' }], 'FORMAT')).toEqual([
      { role: 'system', content: 'FORMAT' },
      { role: 'user', content: 'task' },
    ]);
  });
});

describe('retryMessages', () => {
  it('PRV-050: feeds the failed answer back with every problem listed', () => {
    const messages = retryMessages('{"title": ""}', {
      parseError: null,
      schemaIssues: ['title: Too small'],
      semanticIssues: [{ path: 'count', message: 'needs at least five' }],
    });
    expect(messages).toEqual([
      { role: 'assistant', content: '{"title": ""}' },
      {
        role: 'user',
        content:
          'Your last answer could not be used:\n- title: Too small\n- count: needs at least five\n' +
          'Answer again with one corrected JSON object, and nothing else.',
      },
    ]);
  });
});
