// Parsing one authored JSON file: JSON, then `schemaVersion` (SCH-002), then the strict
// schema (SCH-001), with every problem a PackIssue at its JSON path (SCH-101).
import {
  ContainerSchema,
  EntityMediaSchema,
  ItemBonusSchema,
  ItemLocationSchema,
  VoiceProfileSchema,
} from '@mythos/contracts';
import { ContentSchemaVersionSchema } from '@mythos/contracts/content';
import type { z } from 'zod';
import type { PackIssue } from './types';

/** The only content format version this build reads (ARCH-051). */
const SCHEMA_VERSION = ContentSchemaVersionSchema.value;

/** What a file parsed to, or null, and every problem found on the way. */
export type FileParse<T> = { value: T | null; issues: PackIssue[] };

/** An issue before its file is known. */
type Located = { path: string; message: string };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKeyMessage(key: string): string {
  return `unknown key "${key}"`;
}

/** Zod's issues at dotted paths. An unknown-keys issue becomes one issue per key, at the key. */
function schemaIssues(error: z.ZodError): Located[] {
  return error.issues.flatMap((issue) => {
    const at = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      return issue.keys.map((key) => ({
        path: [...at, key].join('.'),
        message: unknownKeyMessage(key),
      }));
    }
    return [{ path: at.join('.'), message: issue.message }];
  });
}

/**
 * The problem with a file's `schemaVersion`, if any, worded so an author knows what to do: a
 * newer version needs a newer Mythos, never a guess (ARCH-051). Implements SCH-002.
 */
function versionIssue(raw: Record<string, unknown>): Located | null {
  const version = raw.schemaVersion;
  if (version === SCHEMA_VERSION) return null;
  const path = 'schemaVersion';
  const current = String(SCHEMA_VERSION);
  if (version === undefined) {
    return { path, message: `missing: every content file declares "schemaVersion": ${current}` };
  }
  if (typeof version === 'number' && version > SCHEMA_VERSION) {
    return {
      path,
      message: `${String(version)} is newer than this version of Mythos can read (${current}); update Mythos to use this file`,
    };
  }
  return { path, message: `must be ${current}` };
}

/**
 * Parses one authored JSON file with its strict schema. `extraChecks` runs on the raw JSON
 * as well, whether or not the schema passes. Implements SCH-001 and SCH-002.
 */
export function parseFile<T>(
  file: string,
  text: string,
  schema: z.ZodType<T>,
  extraChecks: (raw: Record<string, unknown>) => Located[] = () => [],
): FileParse<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { value: null, issues: [{ file, path: '', message: `not valid JSON: ${reason}` }] };
  }
  const located: Located[] = [];
  if (isRecord(raw)) {
    // A file of another version may have another shape, so its schema issues would mislead.
    const version = versionIssue(raw);
    if (version !== null) return { value: null, issues: [{ file, ...version }] };
    located.push(...extraChecks(raw));
  }
  const parsed = schema.safeParse(raw);
  const issues = [...(parsed.success ? [] : schemaIssues(parsed.error)), ...located];
  return {
    value: parsed.success ? parsed.data : null,
    issues: issues.map((at) => ({ file, ...at })),
  };
}

// ---------------------------------------------------------------- nested keys

const MEDIA_KEYS = Object.keys(EntityMediaSchema.shape);
const VOICE_KEYS = Object.keys(VoiceProfileSchema.shape);
const CONTAINER_KEYS = Object.keys(ContainerSchema.shape);

type Variants = readonly { shape: { type: { value: unknown } } }[];

/** The keys of the union variant whose `type` matches, or null when none does (the schema says so). */
function variantKeys(variants: Variants, value: unknown): readonly string[] | null {
  if (!isRecord(value)) return null;
  const variant = variants.find((option) => option.shape.type.value === value.type);
  return variant === undefined ? null : Object.keys(variant.shape);
}

function unknownKeys(value: unknown, known: readonly string[] | null, at: string): Located[] {
  if (!isRecord(value) || known === null) return [];
  return Object.keys(value)
    .filter((key) => !known.includes(key))
    .map((key) => ({ path: `${at}.${key}`, message: unknownKeyMessage(key) }));
}

/**
 * Unknown keys inside the objects an authored entity takes from runtime schemas that are not
 * strict, which Zod would drop silently. Implements SCH-001 (owner decision).
 */
export function nestedUnknownKeys(raw: Record<string, unknown>): Located[] {
  const bonuses: unknown = raw.bonuses;
  const bonusList: readonly unknown[] = Array.isArray(bonuses) ? bonuses : [];
  return [
    ...unknownKeys(raw.media, MEDIA_KEYS, 'media'),
    ...unknownKeys(raw.voice, VOICE_KEYS, 'voice'),
    ...unknownKeys(
      raw.startingLocation,
      variantKeys(ItemLocationSchema.options, raw.startingLocation),
      'startingLocation',
    ),
    ...unknownKeys(raw.container, CONTAINER_KEYS, 'container'),
    ...bonusList.flatMap((bonus, index) =>
      unknownKeys(bonus, variantKeys(ItemBonusSchema.options, bonus), `bonuses.${String(index)}`),
    ),
  ];
}
