// Row schemas: every row read from SQLite is parsed before use (CONV-051), and every
// JSON column with the contract schema it holds (CONV-030). Each schema maps the
// table's snake_case columns to the contract's camelCase type.
import {
  AppErrorSchema,
  type Branch,
  BranchSchema,
  type Commit,
  CommitOriginSchema,
  CommitPayloadSchema,
  type CommitSet,
  CommitStageSchema,
  EntityIdSchema,
  GameTimeSchema,
  IdSchema,
  JobPrioritySchema,
  JobSchema,
  JobStatusSchema,
  ModelCallRecordSchema,
  type Turn,
  TurnStatusSchema,
  WallTimeSchema,
} from '@mythos/contracts';
import {
  PackIdSchema,
  RulesetIdSchema,
  ScenarioIdSchema,
  SettingIdSchema,
  ThemeIdSchema,
  ToneProfileIdSchema,
} from '@mythos/contracts/content';
import { z } from 'zod';

/** A TEXT column holding JSON that must match `schema`. */
export function jsonColumn<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .transform((text, ctx): unknown => {
      try {
        const parsed: unknown = JSON.parse(text);
        return parsed;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.addIssue({ code: 'custom', message: `not valid JSON: ${reason}` });
        return z.NEVER;
      }
    })
    .pipe(schema);
}

/** An INTEGER column holding 0 or 1. */
export const sqliteBoolean = z
  .union([z.literal(0), z.literal(1)])
  .transform((value) => value === 1);

const RawRowSchema = z.record(z.string(), z.unknown());

function describeKey(row: unknown, keyColumns: readonly string[]): string {
  const raw = RawRowSchema.safeParse(row);
  if (!raw.success) return '(not a row)';
  return keyColumns.map((column) => `${column}=${String(raw.data[column])}`).join(', ');
}

/**
 * Parses one row with `schema`. A row that doesn't match is corrupt data, not an
 * expected failure, so this throws an error naming the table, the row's key, and
 * each problem (CONV-041). Implements CONV-051.
 */
export function parseRow<T extends z.ZodType>(
  table: string,
  schema: T,
  row: unknown,
  keyColumns: readonly string[],
): z.output<T> {
  const parsed = schema.safeParse(row);
  if (parsed.success) return parsed.data;
  const problems = parsed.error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(row)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`${table} row ${describeKey(row, keyColumns)} is invalid: ${problems}`, {
    cause: parsed.error,
  });
}

// ------------------------------------------------------------------- campaign

/** The campaign's one `campaign` row: what it was made from (SCH-110). */
export const CampaignRecordSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  packId: PackIdSchema,
  packVersion: z.string().min(1),
  settingId: SettingIdSchema,
  scenarioId: ScenarioIdSchema,
  toneProfileId: ToneProfileIdSchema,
  rulesetId: RulesetIdSchema,
  themeId: ThemeIdSchema,
  pcId: EntityIdSchema,
  firstSceneId: IdSchema,
  createdAt: WallTimeSchema,
  lastPlayedAt: WallTimeSchema,
});
export type CampaignRecord = z.infer<typeof CampaignRecordSchema>;

export const CampaignRowSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    pack_id: PackIdSchema,
    pack_version: z.string().min(1),
    setting_id: SettingIdSchema,
    scenario_id: ScenarioIdSchema,
    tone_profile_id: ToneProfileIdSchema,
    ruleset_id: RulesetIdSchema,
    theme_id: ThemeIdSchema,
    pc_id: EntityIdSchema,
    first_scene_id: IdSchema,
    created_at: WallTimeSchema,
    last_played_at: WallTimeSchema,
  })
  .transform((row): CampaignRecord => ({
    id: row.id,
    name: row.name,
    packId: row.pack_id,
    packVersion: row.pack_version,
    settingId: row.setting_id,
    scenarioId: row.scenario_id,
    toneProfileId: row.tone_profile_id,
    rulesetId: row.ruleset_id,
    themeId: row.theme_id,
    pcId: row.pc_id,
    firstSceneId: row.first_scene_id,
    createdAt: row.created_at,
    lastPlayedAt: row.last_played_at,
  }));

// ------------------------------------------------------------------- the event log

export const TurnRowSchema = z
  .object({
    id: IdSchema,
    parent_turn_id: IdSchema.nullable(),
    depth: z.int().nonnegative(),
    status: TurnStatusSchema,
    game_time_start: GameTimeSchema,
    copied_from_turn_id: IdSchema.nullable(),
    created_at: WallTimeSchema,
  })
  .transform((row): Turn => ({
    id: row.id,
    parentTurnId: row.parent_turn_id,
    depth: row.depth,
    status: row.status,
    gameTimeStart: row.game_time_start,
    copiedFromTurnId: row.copied_from_turn_id,
    createdAt: row.created_at,
  }));

/** The only commit set format this version reads (ARCH-051). */
export const COMMIT_SET_SCHEMA_VERSION = 1;

export const CommitSetRowSchema = z
  .object({
    id: IdSchema,
    turn_id: IdSchema,
    stage: CommitStageSchema,
    origin: CommitOriginSchema,
    supersedes_set_id: IdSchema.nullable(),
    based_on_set_ids: jsonColumn(z.array(IdSchema)),
    copied_from_set_id: IdSchema.nullable(),
    // Implements ARCH-051: a newer format is rejected, never guessed at.
    schema_version: z.literal(COMMIT_SET_SCHEMA_VERSION, {
      error: (issue) =>
        `commit set schemaVersion ${String(issue.input)} is not supported; this version ` +
        `of Mythos reads schemaVersion ${String(COMMIT_SET_SCHEMA_VERSION)} only`,
    }),
    seq: z.int().nonnegative(),
    created_at: WallTimeSchema,
  })
  .transform((row): CommitSet => ({
    id: row.id,
    turnId: row.turn_id,
    stage: row.stage,
    origin: row.origin,
    supersedesSetId: row.supersedes_set_id,
    basedOnSetIds: row.based_on_set_ids,
    copiedFromSetId: row.copied_from_set_id,
    schemaVersion: row.schema_version,
    seq: row.seq,
    createdAt: row.created_at,
  }));

export const CommitRowSchema = z
  .object({
    id: IdSchema,
    set_id: IdSchema,
    seq: z.int().nonnegative(),
    payload: jsonColumn(CommitPayloadSchema),
  })
  .transform((row): Commit => ({
    id: row.id,
    setId: row.set_id,
    seq: row.seq,
    payload: row.payload,
  }));

// ------------------------------------------------------------------- mutable state

export const BranchRowSchema = z
  .object({
    id: IdSchema,
    name: BranchSchema.shape.name,
    head_turn_id: IdSchema,
    forked_from_turn_id: IdSchema.nullable(),
    archived: sqliteBoolean,
    created_at: WallTimeSchema,
  })
  .transform((row): Branch => ({
    id: row.id,
    name: row.name,
    headTurnId: row.head_turn_id,
    forkedFromTurnId: row.forked_from_turn_id,
    archived: row.archived,
    createdAt: row.created_at,
  }));

/** One version of a `campaign_state` key; the value is parsed by the key's schema. */
export const CampaignStateRowSchema = z
  .object({
    version: z.int().positive(),
    value: jsonColumn(z.json()),
    created_at: WallTimeSchema,
  })
  .transform((row) => ({ version: row.version, value: row.value, createdAt: row.created_at }));

// ------------------------------------------------------------------- records and jobs

export const ModelCallRowSchema = z
  .object({ id: IdSchema, record: jsonColumn(ModelCallRecordSchema) })
  .transform((row) => row.record);

/** A background job as stored: the queue's record plus its payload and last error (PRV-062). */
export const PersistedJobSchema = JobSchema.extend({
  payload: z.json(),
  lastError: AppErrorSchema.nullable(),
});
export type PersistedJob = z.infer<typeof PersistedJobSchema>;

export const JobRowSchema = z
  .object({
    id: IdSchema,
    type: z.string().min(1),
    priority: JobPrioritySchema,
    device_id: z.string().min(1),
    turn_id: IdSchema.nullable(),
    status: JobStatusSchema,
    attempts: z.int().nonnegative(),
    payload: jsonColumn(z.json()),
    last_error: jsonColumn(AppErrorSchema).nullable(),
    created_at: WallTimeSchema,
    updated_at: WallTimeSchema,
  })
  .transform((row): PersistedJob => ({
    id: row.id,
    type: row.type,
    priority: row.priority,
    deviceId: row.device_id,
    turnId: row.turn_id,
    status: row.status,
    attempts: row.attempts,
    payload: row.payload,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

// ------------------------------------------------------------------- shared

/** The row `INSERT … RETURNING seq` gives back. */
export const SeqRowSchema = z.object({ seq: z.int().nonnegative() });

/** The row `SELECT COUNT(*) AS count` gives back. */
export const CountRowSchema = z.object({ count: z.int().nonnegative() });
