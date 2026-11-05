// The content snapshot (SCH-111, ARCH-045): written once at campaign creation, then
// only read. A copied campaign folder is complete without the pack or the library
// (ARCH-031), so the theme is snapshotted too.
import { EntitySchema } from '@mythos/contracts';
import {
  CalendarDefinitionSchema,
  HistoryFileSchema,
  RelationshipsFileSchema,
  RulesetSchema,
  ScenarioSchema,
  SettingSchema,
  SlotSchemaDefinitionSchema,
  ThemeSchema,
  ToneProfileSchema,
} from '@mythos/contracts/content';
import { z } from 'zod';
import { jsonColumn, parseRow } from './rows';
import type { Database } from './sqlite';

/** Each kind of canon entry and the schema its JSON holds. */
const canonSchemas = {
  setting: SettingSchema,
  calendar: CalendarDefinitionSchema,
  slots: SlotSchemaDefinitionSchema,
  tone: ToneProfileSchema,
  ruleset: RulesetSchema,
  scenario: ScenarioSchema,
  theme: ThemeSchema,
  entity: EntitySchema, // runtime form (SCH-005), with its canon Markdown
  history: HistoryFileSchema,
  relationships: RelationshipsFileSchema,
} as const;

export type CanonKind = keyof typeof canonSchemas;
export type CanonValue<K extends CanonKind> = z.infer<(typeof canonSchemas)[K]>;

/** One snapshotted definition, entity, or file, with its Markdown if it has one. */
export type CanonEntry<K extends CanonKind = CanonKind> = {
  [Kind in K]: { kind: Kind; id: string; value: CanonValue<Kind>; markdown: string | null };
}[K];

/** The template layers snapshotted at creation (CTX-004, CTX-005). */
export const SnapshotTemplateLayerSchema = z.enum(['tone-profile', 'pack', 'ruleset', 'engine']);
export type SnapshotTemplateLayer = z.infer<typeof SnapshotTemplateLayerSchema>;

/** One template or partial file; `path` is relative to its layer's folder, with `/`. */
export const CanonTemplateSchema = z.object({
  layer: SnapshotTemplateLayerSchema,
  path: z.string().min(1),
  text: z.string(),
});
export type CanonTemplate = z.infer<typeof CanonTemplateSchema>;

/** The content snapshot: every canon entry and template file. */
export type CanonSnapshot = { entries: readonly CanonEntry[]; templates: readonly CanonTemplate[] };

/**
 * Inserts every entry and template. Must run inside a transaction: `writeCanon` and
 * `writeCampaignStart` provide one. An entry that exists already throws.
 */
export function insertCanon(db: Database, snapshot: CanonSnapshot): void {
  const insertEntry = db.prepare(
    'INSERT INTO canon (kind, id, json, markdown) VALUES (:kind, :id, :json, :markdown)',
  );
  const insertTemplate = db.prepare(
    'INSERT INTO canon_templates (layer, path, text) VALUES (:layer, :path, :text)',
  );
  for (const entry of snapshot.entries) {
    insertEntry.run({
      kind: entry.kind,
      id: entry.id,
      json: JSON.stringify(entry.value),
      markdown: entry.markdown,
    });
  }
  for (const template of snapshot.templates) {
    insertTemplate.run({ layer: template.layer, path: template.path, text: template.text });
  }
}

/**
 * Writes the content snapshot, every entry and template in one transaction. Canon is
 * never replaced: writing an entry that exists throws.
 */
export function writeCanon(db: Database, snapshot: CanonSnapshot): void {
  db.transaction(() => {
    insertCanon(db, snapshot);
  });
}

// A row of one kind, its JSON parsed with that kind's schema (CONV-030).
function canonRowSchema<K extends CanonKind>(kind: K) {
  return z
    .object({
      id: z.string().min(1),
      json: jsonColumn(canonSchemas[kind]),
      markdown: z.string().nullable(),
    })
    .transform((row) => ({
      kind,
      id: row.id,
      // Zod loses K through the generic index; the kind's own schema just parsed it.
      value: row.json as CanonValue<K>,
      markdown: row.markdown,
    }));
}

/** One canon entry, or null if the snapshot has none of that kind and ID. */
export function readCanon<K extends CanonKind>(
  db: Database,
  kind: K,
  id: string,
): { kind: K; id: string; value: CanonValue<K>; markdown: string | null } | null {
  const row = db
    .prepare('SELECT id, json, markdown FROM canon WHERE kind = :kind AND id = :id')
    .get({ kind, id });
  return row === undefined ? null : parseRow('canon', canonRowSchema(kind), row, ['id']);
}

/** Every canon entry of one kind, sorted by ID. */
export function listCanon<K extends CanonKind>(
  db: Database,
  kind: K,
): { kind: K; id: string; value: CanonValue<K>; markdown: string | null }[] {
  // SQLite's default BINARY collation compares UTF-8 bytes, which is code-point order,
  // the same as cmp (CONV-087).
  return db
    .prepare('SELECT id, json, markdown FROM canon WHERE kind = :kind ORDER BY id')
    .all({ kind })
    .map((row) => parseRow('canon', canonRowSchema(kind), row, ['id']));
}

/** Every snapshotted template file, sorted by layer and path. */
export function readTemplates(db: Database): CanonTemplate[] {
  return db
    .prepare('SELECT layer, path, text FROM canon_templates ORDER BY layer, path')
    .all()
    .map((row) => parseRow('canon_templates', CanonTemplateSchema, row, ['layer', 'path']));
}
