// Steps 1 and 2 of the structured-output pipeline (PRV-050): a model-facing Zod schema as
// JSON Schema, then that JSON Schema adapted to what the profile's provider can constrain
// decoding with (PRV-052). Both are pure. The probe adapts with the same function
// (PRV-092). Full Zod validation still runs on every answer, so an adapted schema may be
// looser than the Zod schema, never stricter.
import type { ModelProfile, ProviderConfig } from '@mythos/contracts';
import { z } from 'zod';

/** A JSON Schema document or subschema, as `z.toJSONSchema` produces and adapters send. */
export type JsonSchema = Record<string, unknown>;

const converted = new WeakMap<z.ZodType, JsonSchema>();

/**
 * The JSON Schema for a model-facing Zod schema, converted once per schema object and
 * shared, so callers must not change it. A rulings schema specialized per campaign
 * (CON-035) is cached as long as its caller keeps the same schema object. A schema that
 * cannot be converted, such as one with a transform, throws: model-facing schemas must
 * convert (CON-004), so it is a programmer error. Implements PRV-050 step 1 and CON-004.
 */
export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const cached = converted.get(schema);
  if (cached !== undefined) return cached;
  const jsonSchema: JsonSchema = z.toJSONSchema(schema);
  converted.set(schema, jsonSchema);
  return jsonSchema;
}

/**
 * The schema to send for a profile's provider and structured-output method. Only
 * Anthropic's `json-schema` and `tool-call` change it; `prompt-only` puts the schema in
 * the prompt, where nothing constrains decoding, so it keeps every constraint as a hint.
 * Returns a new object and never changes `jsonSchema`. Implements PRV-052.
 */
export function adaptSchema(
  jsonSchema: JsonSchema,
  providerType: ProviderConfig['type'],
  method: ModelProfile['structuredOutput'],
): JsonSchema {
  if (providerType !== 'anthropic' || method === 'prompt-only') return jsonSchema;
  return adaptForAnthropic(jsonSchema);
}

// ------------------------------------------------------------------ Anthropic (PRV-040)
// From Anthropic's structured-outputs page, rechecked on 2026-11-06. Unsupported keywords
// get a 400, not silence, so each one is removed or rewritten here.

/** Keywords Anthropic does not support, removed wherever they appear. */
const REMOVED_KEYWORDS = new Set([
  '$schema',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'maxItems',
]);

/** The string formats Anthropic supports; any other `format` is removed. */
const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** Regex features Anthropic refuses: backreferences, lookaround, and word boundaries. */
const UNSUPPORTED_PATTERN = /\\[1-9]|\\k<|\(\?<?[=!]|\\[bB]/;

/** Keywords whose value is a map from names to subschemas. */
const SUBSCHEMA_MAPS = new Set(['properties', '$defs', 'definitions', 'patternProperties']);
/** Keywords whose value is a list of subschemas. */
const SUBSCHEMA_LISTS = new Set(['anyOf', 'oneOf', 'allOf', 'prefixItems']);
/** Keywords whose value is one subschema. */
const SUBSCHEMAS = new Set(['items', 'not', 'if', 'then', 'else', 'contains', 'propertyNames']);

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectSchema(node: JsonSchema): boolean {
  const { type } = node;
  return (
    type === 'object' || (Array.isArray(type) && type.includes('object')) || 'properties' in node
  );
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** Whether Anthropic accepts a keyword's value as it is. */
function keeps(key: string, value: unknown): boolean {
  if (REMOVED_KEYWORDS.has(key)) return false;
  if (key === 'minItems') return value === 0 || value === 1;
  if (key === 'format') return typeof value === 'string' && SUPPORTED_FORMATS.has(value);
  if (key === 'pattern') return typeof value === 'string' && !UNSUPPORTED_PATTERN.test(value);
  if (key === 'enum') return Array.isArray(value) && value.every(isPrimitive);
  return true;
}

/** One subschema, adapted, with every subschema inside it adapted too. */
function adaptForAnthropic(node: JsonSchema): JsonSchema {
  const adapted: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (!keeps(key, value)) continue;
    adapted[key] = adaptValue(key, value);
  }
  // Anthropic lists `anyOf`, not `oneOf`, which Zod emits for discriminated unions. The
  // branches of a discriminated union never overlap, so `anyOf` accepts the same values.
  if ('oneOf' in adapted) {
    const branches = adapted.oneOf;
    delete adapted.oneOf;
    if ('anyOf' in adapted) adapted.allOf = [...asList(adapted.allOf), { anyOf: branches }];
    else adapted.anyOf = branches;
  }
  // Every object must be closed. An open one (a record) cannot be constrained at all.
  if (isObjectSchema(adapted)) adapted.additionalProperties = false;
  return adapted;
}

function adaptValue(key: string, value: unknown): unknown {
  if (SUBSCHEMA_MAPS.has(key) && isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, sub]) => [
        name,
        isRecord(sub) ? adaptForAnthropic(sub) : sub,
      ]),
    );
  }
  if (SUBSCHEMA_LISTS.has(key) && Array.isArray(value)) {
    return value.map((sub: unknown) => (isRecord(sub) ? adaptForAnthropic(sub) : sub));
  }
  if (SUBSCHEMAS.has(key) && isRecord(value)) return adaptForAnthropic(value);
  return value;
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
