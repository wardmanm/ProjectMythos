import { z } from 'zod';
import { EntityIdSchema } from './primitives';
import {
  ClockIdSchema,
  DifficultySchema,
  EffectLevelSchema,
  HarmLevelSchema,
  PlannedConsequenceTypeSchema,
  StatIdSchema,
  StatusTagSchema,
} from './rules';

/**
 * Limits that narrow the model-facing ruling schema to one campaign's ruleset (CON-035).
 * `core` derives them from the ruleset; `BROAD_RULING_LIMITS` gives the storage schema.
 */
export type RulingLimits = {
  statIds: readonly [string, ...string[]] | null; // null = any stat ID
  tagIds: readonly [string, ...string[]] | null; // null = any tag ID
  difficulty: { min: number; max: number };
  maxHarmLevel: number; // the ruleset's fatal level
  clockSegments: { min: number; max: number };
  maxTicks: number;
};

export const BROAD_RULING_LIMITS: RulingLimits = {
  statIds: null,
  tagIds: null,
  difficulty: { min: -10, max: 10 },
  maxHarmLevel: 9,
  clockSegments: { min: 2, max: 24 },
  maxTicks: 6,
};

/** Builds every model-facing ruling schema for the given limits. */
export function makeRulingSchemas(limits: RulingLimits) {
  const stat: z.ZodType<string> = limits.statIds ? z.enum(limits.statIds) : StatIdSchema;
  const tag: z.ZodType<string> = limits.tagIds ? z.enum(limits.tagIds) : StatusTagSchema;
  const harmLevel = HarmLevelSchema.max(limits.maxHarmLevel);
  const difficulty = DifficultySchema.min(limits.difficulty.min).max(limits.difficulty.max);

  /**
   * Something the GM intends to happen as part of an outcome. No UUIDs (CON-003).
   * - `harm` is required when type is 'harm'.
   * - `clockTicks` is allowed on 'progress' and 'complication'.
   * - `treatment` is required when type is 'treatment'.
   * Values are written for standard effect; roll rulings scale success items (RUL §4.3).
   */
  const plannedConsequence = z.object({
    type: PlannedConsequenceTypeSchema,
    targetId: EntityIdSchema,
    description: z.string().min(1).max(300),
    harm: z
      .object({
        level: harmLevel,
        name: z.string().min(1).max(80),
        tags: z.array(tag).min(1),
      })
      .optional(),
    clockTicks: z
      .object({ clockId: ClockIdSchema, ticks: z.int().min(1).max(limits.maxTicks) })
      .optional(),
    treatment: z
      .object({ harmName: z.string().min(1).max(80).nullable() }) // null = the most severe harm
      .optional(),
  });

  /** A clock the GM introduces in this ruling. Created before any ticks apply. */
  const plannedClock = z.object({
    id: ClockIdSchema,
    name: z.string().min(1).max(80),
    segments: z.int().min(limits.clockSegments.min).max(limits.clockSegments.max),
    visibility: z.enum(['player', 'gm']),
    ownerId: EntityIdSchema.optional(),
    kind: z.enum(['progress', 'stat-change']),
    statChange: z
      .object({ characterId: EntityIdSchema, stat, delta: z.int().min(-3).max(3) })
      .optional(),
  });

  /** Explanations for a ruling, one per explanation level above 'off'. */
  const explanation = z.object({
    playerSafe: z.string().max(600), // uses only what the PC knows
    full: z.string().max(1200), // may include hidden truth
  });

  /** The GM decided the outcome from the fiction; no roll. Values are applied as written. */
  const direct = z.object({
    kind: z.literal('direct'),
    elapsedMinutes: z.int().nonnegative(), // game time the action takes
    outcome: z.enum(['success', 'partial', 'failure']),
    effect: EffectLevelSchema,
    clocks: z.array(plannedClock).max(3),
    consequences: z.array(plannedConsequence),
    explanation,
  });

  /**
   * Stakes, set before the roll (RUL §4.2):
   * - `success`: what the actor achieves. Applied on critical, success, and partial.
   * - `partial`: costs added on a partial.
   * - `failure`: costs on a failure. Success items do not apply.
   */
  const stakes = z.object({
    success: z.array(plannedConsequence).min(1),
    partial: z.array(plannedConsequence).min(1),
    failure: z.array(plannedConsequence).min(1),
  });

  /** The GM calls for a roll. */
  const roll = z.object({
    kind: z.literal('roll'),
    elapsedMinutes: z.int().nonnegative(),
    actorId: EntityIdSchema,
    stat,
    difficulty, // the situation only; the engine applies harm and items
    effectModifier: z.int().min(-1).max(1), // tools, scale, quality of the approach
    itemIds: z.array(EntityIdSchema).max(3), // items the actor uses for a roll bonus
    intent: z.string().min(1).max(300), // what the actor is trying to achieve
    clocks: z.array(plannedClock).max(3),
    stakes,
    explanation,
  });

  /** Out-of-character input: the GM answers the player directly. */
  const ooc = z.object({
    kind: z.literal('ooc'),
    reply: z.string().min(1).max(2000),
    elapsedMinutes: z.int().nonnegative(), // > 0 for skips, e.g. "skip to morning"
  });

  /** Output of the adjudication step. Model-facing. */
  const ruling = z.discriminatedUnion('kind', [direct, roll, ooc]);

  return { plannedConsequence, plannedClock, explanation, direct, stakes, roll, ooc, ruling };
}

const broad = makeRulingSchemas(BROAD_RULING_LIMITS);

/** Storage and API schemas: any ruleset's values pass; semantic validation narrows them. */
export const PlannedConsequenceSchema = broad.plannedConsequence;
export type PlannedConsequence = z.infer<typeof PlannedConsequenceSchema>;
export const PlannedClockSchema = broad.plannedClock;
export type PlannedClock = z.infer<typeof PlannedClockSchema>;
export const RulingExplanationSchema = broad.explanation;
export const DirectRulingSchema = broad.direct;
export const RollStakesSchema = broad.stakes;
export const RollRulingSchema = broad.roll;
export const OocRulingSchema = broad.ooc;
export const RulingSchema = broad.ruling;
export type Ruling = z.infer<typeof RulingSchema>;
