// Per-campaign state that is not part of the event log (TRN-002): the current branch
// (TRN-101), the content settings (CSET-020), and campaign template overrides
// (CTX-005). Every write adds a version, so each key keeps its history; the current
// value is the highest version.
import { IdSchema, type WallTime } from '@mythos/contracts';
import { ContentSettingsSchema } from '@mythos/contracts/content';
import { z } from 'zod';
import { CampaignStateRowSchema, parseRow } from './rows';
import type { Database } from './sqlite';

/** A `campaign_state` key. A template override is `template:` and the template's path. */
export type StateKey = 'current_branch_id' | 'content_settings' | `template:${string}`;

/** The value each key holds. */
export type StateValue<K extends StateKey> = K extends 'current_branch_id'
  ? z.infer<typeof IdSchema>
  : K extends 'content_settings'
    ? z.infer<typeof ContentSettingsSchema>
    : string;

/** One version of a key's value. */
export type StateVersion<K extends StateKey> = {
  version: number;
  value: StateValue<K>;
  createdAt: WallTime;
};

const TemplateTextSchema = z.string();

function schemaFor(key: StateKey): z.ZodType {
  if (key === 'current_branch_id') return IdSchema;
  if (key === 'content_settings') return ContentSettingsSchema;
  return TemplateTextSchema;
}

function parseVersion<K extends StateKey>(key: K, row: unknown): StateVersion<K> {
  const stored = parseRow('campaign_state', CampaignStateRowSchema, row, ['version']);
  const value = schemaFor(key).safeParse(stored.value);
  if (!value.success) {
    throw new Error(
      `campaign_state row key=${key}, version=${String(stored.version)} is invalid: ` +
        value.error.issues.map((issue) => issue.message).join('; '),
    );
  }
  // TypeScript cannot tie schemaFor's result to K; the key's own schema just parsed it.
  const parsed = value.data as StateValue<K>;
  return { version: stored.version, value: parsed, createdAt: stored.createdAt };
}

/** The current value of `key`, or null if it was never written. */
export function readState<K extends StateKey>(db: Database, key: K): StateValue<K> | null {
  const row = db
    .prepare(
      `SELECT version, value, created_at FROM campaign_state
       WHERE key = :key ORDER BY version DESC LIMIT 1`,
    )
    .get({ key });
  return row === undefined ? null : parseVersion(key, row).value;
}

/**
 * Writes a new version of `key`. Not a commit, and campaign-wide on every branch
 * (TRN-002, CSET-020). Returns the new version number.
 */
export function writeState<K extends StateKey>(
  db: Database,
  key: K,
  value: StateValue<K>,
  createdAt: WallTime,
): number {
  const json = JSON.stringify(schemaFor(key).parse(value));
  const row = db
    .prepare(
      `INSERT INTO campaign_state (key, version, value, created_at)
       VALUES (:key, (SELECT COALESCE(MAX(version), 0) + 1 FROM campaign_state WHERE key = :key),
               :value, :createdAt)
       RETURNING version`,
    )
    .get({ key, value: json, createdAt });
  return parseRow('campaign_state', z.object({ version: z.int().positive() }), row, ['version'])
    .version;
}

/** Every version of `key`, oldest first. */
export function readStateHistory<K extends StateKey>(db: Database, key: K): StateVersion<K>[] {
  return db
    .prepare(
      'SELECT version, value, created_at FROM campaign_state WHERE key = :key ORDER BY version',
    )
    .all({ key })
    .map((row) => parseVersion(key, row));
}
