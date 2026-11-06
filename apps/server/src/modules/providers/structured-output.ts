// The pure steps of the structured-output pipeline (PRV-050): the format instruction
// (step 3), extracting JSON from an answer (step 5), validating it (step 6), and the
// feedback a retry sends (step 7). Format instructions are locked content: the engine
// writes them, and no template contains one (CTX-007).
import {
  type ChatMessage,
  err,
  type ModelProfile,
  ok,
  type Result,
  type SemanticIssue,
} from '@mythos/contracts';
import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';
import type { JsonSchema } from './schema-adapt';

/** What was wrong with one answer, as a model call attempt records it. */
export type OutputProblems = {
  parseError: string | null;
  schemaIssues: string[];
  semanticIssues: SemanticIssue[];
};

/**
 * The format instruction for a method. `json-schema` and `tool-call` constrain decoding,
 * so they get a one-line reminder; `prompt-only` gets the whole schema and a minimal
 * example of its shape. `jsonSchema` is the unadapted schema. Implements PRV-050 step 3.
 */
export function formatInstruction(
  method: ModelProfile['structuredOutput'],
  schemaName: string,
  jsonSchema: JsonSchema,
): string {
  const answer = `Answer with a single JSON object for "${schemaName}", and nothing else.`;
  if (method !== 'prompt-only') return answer;
  return [
    `${answer} Write no code fences and no text before or after it.`,
    'The object must match this JSON Schema:',
    JSON.stringify(jsonSchema),
    'A minimal example of its shape, with placeholder values:',
    JSON.stringify(exampleOf(jsonSchema, jsonSchema, 0)),
  ].join('\n');
}

/**
 * The messages with the format instruction added as a system message of its own, right
 * after the leading system messages, so a floor repeated at the end of the task tier
 * stays nearest the output (CSET-042). Implements PRV-050 step 3.
 */
export function withFormatInstruction(
  messages: readonly ChatMessage[],
  instruction: string,
): ChatMessage[] {
  const firstOther = messages.findIndex((message) => message.role !== 'system');
  const at = firstOther === -1 ? messages.length : firstOther;
  const formatMessage: ChatMessage = { role: 'system', content: instruction };
  return [...messages.slice(0, at), formatMessage, ...messages.slice(at)];
}

/** Code fence markers, with any language tag after the opening one. */
const FENCE = /```[\w-]*/g;

/**
 * The JSON value in an answer: code fences stripped, then the text from the first `{` to
 * the last `}`, parsed, or repaired with `jsonrepair` and parsed if that fails. When no
 * `}` follows the first `{`, as in an answer cut off by its token limit, the text runs to
 * the end. Implements PRV-050 step 5.
 */
export function extractJson(text: string): Result<unknown, string> {
  const unfenced = text.replace(FENCE, '');
  const start = unfenced.indexOf('{');
  if (start === -1) return err('The answer holds no JSON object.');
  const end = unfenced.lastIndexOf('}');
  const candidate = end > start ? unfenced.slice(start, end + 1) : unfenced.slice(start);
  try {
    return ok(JSON.parse(candidate));
  } catch (parseError) {
    try {
      return ok(JSON.parse(jsonrepair(candidate)));
    } catch {
      // The first error says where the model's own JSON went wrong.
      return err(`The answer is not valid JSON: ${messageOf(parseError)}`);
    }
  }
}

/**
 * Steps 5 and 6 for one answer: the parsed value, or every problem found. A value is
 * returned only once it has passed the Zod schema and `semanticCheck` (CONV-032).
 * Implements PRV-050.
 */
export function checkOutput<T>(
  text: string,
  schema: z.ZodType<T>,
  semanticCheck: ((value: T) => SemanticIssue[]) | undefined,
): Result<T, OutputProblems> {
  const extracted = extractJson(text);
  if (!extracted.ok) {
    return err({ parseError: extracted.error, schemaIssues: [], semanticIssues: [] });
  }
  const parsed = schema.safeParse(extracted.value);
  if (!parsed.success) {
    const schemaIssues = parsed.error.issues.map(
      (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
    );
    return err({ parseError: null, schemaIssues, semanticIssues: [] });
  }
  const semanticIssues = semanticCheck?.(parsed.data) ?? [];
  if (semanticIssues.length > 0) return err({ parseError: null, schemaIssues: [], semanticIssues });
  return ok(parsed.data);
}

/**
 * What a retry adds to the conversation: the answer that failed, as the assistant's, and
 * a user message listing its problems. Implements PRV-050 step 7.
 */
export function retryMessages(answer: string, problems: OutputProblems): ChatMessage[] {
  const lines = [
    ...(problems.parseError === null ? [] : [problems.parseError]),
    ...problems.schemaIssues,
    ...problems.semanticIssues.map((issue) => `${issue.path || '(root)'}: ${issue.message}`),
  ];
  const feedback = [
    'Your last answer could not be used:',
    ...lines.map((line) => `- ${line}`),
    'Answer again with one corrected JSON object, and nothing else.',
  ].join('\n');
  return [
    { role: 'assistant', content: answer },
    { role: 'user', content: feedback },
  ];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------ minimal examples

/** How deep an example goes, so a recursive schema still ends. */
const EXAMPLE_DEPTH = 12;

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A minimal value of a schema's shape: required properties only, the first enum value or
 * union branch, one item for an array that needs one, and placeholder text and numbers.
 * It shows the shape; it need not pass every constraint.
 */
function exampleOf(node: unknown, root: JsonSchema, depth: number): unknown {
  if (!isRecord(node) || depth > EXAMPLE_DEPTH) return null;
  if ('const' in node) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0] ?? null;
  if (typeof node.$ref === 'string') return exampleOf(resolveRef(root, node.$ref), root, depth + 1);
  const branches = node.anyOf ?? node.oneOf ?? node.allOf;
  if (Array.isArray(branches)) return exampleOf(branches[0], root, depth + 1);
  const type: unknown = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case 'object':
      return objectExample(node, root, depth);
    case 'array': {
      const needsOne = typeof node.minItems === 'number' && node.minItems > 0;
      return needsOne ? [exampleOf(node.items, root, depth + 1)] : [];
    }
    case 'string':
      return '...';
    case 'integer':
    case 'number':
      return typeof node.minimum === 'number' ? node.minimum : 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function objectExample(node: JsonSchema, root: JsonSchema, depth: number): JsonSchema {
  const properties = isRecord(node.properties) ? node.properties : {};
  const required = Array.isArray(node.required) ? node.required : [];
  const example: JsonSchema = {};
  for (const name of required) {
    if (typeof name === 'string') example[name] = exampleOf(properties[name], root, depth + 1);
  }
  return example;
}

/** A local `#/…` reference within the root schema, or null for any other. */
function resolveRef(root: JsonSchema, ref: string): unknown {
  if (!ref.startsWith('#/')) return null;
  let node: unknown = root;
  for (const part of ref.slice(2).split('/')) node = isRecord(node) ? node[part] : null;
  return node;
}
