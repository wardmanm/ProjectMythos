import { RulingSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { adaptSchema, type JsonSchema, toJsonSchema } from './schema-adapt';

/** Every subschema in `node` that is an object schema, found by walking every value. */
function objectSchemas(node: unknown, found: JsonSchema[] = []): JsonSchema[] {
  if (Array.isArray(node)) {
    for (const item of node) objectSchemas(item, found);
  } else if (typeof node === 'object' && node !== null) {
    const record = node as JsonSchema;
    if (record.type === 'object') found.push(record);
    for (const value of Object.values(record)) objectSchemas(value, found);
  }
  return found;
}

/** Every key used anywhere in `node`, property names included. */
function keysIn(node: unknown): Set<string> {
  const keys = new Set<string>();
  JSON.parse(JSON.stringify(node), (key: string, value: unknown) => {
    keys.add(key);
    return value;
  });
  return keys;
}

const unsupported = [
  '$schema',
  'oneOf',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
];

describe('toJsonSchema', () => {
  it('CON-004, PRV-050: converts the model-facing ruling schema, once per schema object', () => {
    const first = toJsonSchema(RulingSchema);
    expect(first.oneOf).toBeDefined();
    expect(toJsonSchema(RulingSchema)).toBe(first);
  });

  it('CON-004: a schema that cannot become JSON Schema throws, as a programmer error', () => {
    const withTransform = z.object({ name: z.string().transform((name) => name.length) });
    expect(() => toJsonSchema(withTransform)).toThrow(/Transforms cannot be represented/);
  });
});

describe('adaptSchema', () => {
  it('PRV-052, PRV-040: the Anthropic ruling schema closes every object and keeps no unsupported keyword', () => {
    const original = toJsonSchema(RulingSchema);
    const adapted = adaptSchema(original, 'anthropic', 'json-schema');
    const objects = objectSchemas(adapted);
    expect(objects.length).toBeGreaterThan(5);
    for (const object of objects) expect(object.additionalProperties).toBe(false);
    const keys = keysIn(adapted);
    for (const keyword of unsupported) expect(keys.has(keyword), keyword).toBe(false);
    expect(adapted.anyOf).toHaveLength((original.oneOf as unknown[]).length);
    // The cached original is untouched.
    expect(original.oneOf).toBeDefined();
    expect(keysIn(original).has('maxLength')).toBe(true);
  });

  it('PRV-052: tool-call is adapted the same way as json-schema', () => {
    const schema = toJsonSchema(RulingSchema);
    expect(adaptSchema(schema, 'anthropic', 'tool-call')).toEqual(
      adaptSchema(schema, 'anthropic', 'json-schema'),
    );
  });

  it('PRV-052: keeps minItems of 0 or 1 and drops a larger one', () => {
    const schema = toJsonSchema(
      z.object({ one: z.array(z.string()).min(1), three: z.array(z.string()).min(3) }),
    );
    const adapted = adaptSchema(schema, 'anthropic', 'json-schema');
    expect(adapted.properties).toEqual({
      one: { type: 'array', minItems: 1, items: { type: 'string' } },
      three: { type: 'array', items: { type: 'string' } },
    });
  });

  it('PRV-052: drops unsupported formats, regex features, and enums of complex values', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        cuid: { type: 'string', format: 'cuid' },
        slug: { type: 'string', pattern: '^[a-z]+$' },
        repeat: { type: 'string', pattern: '^(a)\\1$' },
        ahead: { type: 'string', pattern: '^(?=a)a+$' },
        word: { type: 'string', pattern: '\\bcat\\b' },
        flat: { enum: ['a', 1, true, null] },
        nested: { enum: [{ a: 1 }] },
      },
    };
    expect(adaptSchema(schema, 'anthropic', 'json-schema')).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        cuid: { type: 'string' },
        slug: { type: 'string', pattern: '^[a-z]+$' },
        repeat: { type: 'string' },
        ahead: { type: 'string' },
        word: { type: 'string' },
        flat: { enum: ['a', 1, true, null] },
        nested: {},
      },
      additionalProperties: false,
    });
  });

  it('PRV-052: closes an open record and an object with no type', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        tags: { type: 'object', additionalProperties: { type: 'string' } },
        untyped: { properties: { a: { type: 'string' } } },
      },
    };
    const adapted = adaptSchema(schema, 'anthropic', 'json-schema');
    expect(adapted.properties).toEqual({
      tags: { type: 'object', additionalProperties: false },
      untyped: { properties: { a: { type: 'string' } }, additionalProperties: false },
    });
  });

  it('PRV-052: a property named like a removed keyword is kept', () => {
    const schema = toJsonSchema(z.object({ minimum: z.int(), format: z.string() }));
    const adapted = adaptSchema(schema, 'anthropic', 'json-schema');
    expect(Object.keys(adapted.properties as JsonSchema)).toEqual(['minimum', 'format']);
  });

  it('PRV-052: prompt-only and the other providers get the schema unchanged', () => {
    const schema = toJsonSchema(RulingSchema);
    expect(adaptSchema(schema, 'anthropic', 'prompt-only')).toBe(schema);
    for (const type of ['ollama', 'openai-compatible', 'mock'] as const) {
      expect(adaptSchema(schema, type, 'json-schema')).toBe(schema);
    }
  });
});
