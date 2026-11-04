import { z } from 'zod';
import { EntityIdSchema, GameTimeSchema, IdSchema } from './primitives';

/*
 * Rules values are defined by the campaign's ruleset (07-rules). The ranges below are
 * outer limits only; the ruleset narrows them, and semantic validation enforces it.
 */

/** A stat ID from the ruleset, e.g. "str". */
export const StatIdSchema = z.string().regex(/^[a-z][a-z0-9]{0,11}$/);
export type StatId = z.infer<typeof StatIdSchema>;

export const StatRatingSchema = z.int().min(-5).max(20);

/** Keys are exactly the ruleset's stat IDs (CON-024). */
export const StatBlockSchema = z.record(StatIdSchema, StatRatingSchema);
export type StatBlock = z.infer<typeof StatBlockSchema>;

/** GM-set adjustment from the situation, in points (RUL §3.2). */
export const DifficultySchema = z.int().min(-10).max(10);

export const RollResultSchema = z.enum(['critical', 'success', 'partial', 'failure']);
export type RollResult = z.infer<typeof RollResultSchema>;

export const EffectLevelSchema = z.enum(['limited', 'standard', 'great']);
export type EffectLevel = z.infer<typeof EffectLevelSchema>;

export const DieValueSchema = z.int().min(1).max(100);

/** One labeled adjustment to a dice pool or to effect, shown on the dice card (RUL §3). */
export const RollModifierSchema = z.object({
  source: z.enum(['item', 'harm', 'ruling', 'critical']),
  label: z.string().min(1).max(80), // e.g. "Grappling hook", "Cracked Ribs (moderate)"
  value: z.int().min(-20).max(20), // points (RUL §3.2)
});
export type RollModifier = z.infer<typeof RollModifierSchema>;

/** A completed roll. Raw dice are always recorded (CONV-062). Reading rules: RUL §3. */
export const RollSchema = z.object({
  stat: StatIdSchema,
  rating: StatRatingSchema,
  difficulty: DifficultySchema,
  modifiers: z.array(RollModifierSchema), // item and harm points
  points: z.int(), // rating + difficulty + sum(modifiers)
  method: z.enum(['pool-highest', 'pool-count', 'sum']),
  sides: z.int().min(2).max(100),
  dice: z.array(DieValueSchema).min(1),
  kept: z.array(DieValueSchema).min(1), // all dice, or the kept die for an empty pool
  total: z.int(), // the value read: highest die, successes counted, or sum plus bonus
  result: RollResultSchema,
  effectModifiers: z.array(RollModifierSchema), // ruling, harm, critical
  effect: EffectLevelSchema.nullable(), // null for resistance rolls
});
export type Roll = z.infer<typeof RollSchema>;

/** 1 = least severe. The ruleset defines the levels; one above its last is fatal. */
export const HarmLevelSchema = z.int().min(1).max(9);
export type HarmLevel = z.infer<typeof HarmLevelSchema>;

/** A harm tag ID from the ruleset, e.g. "physical". */
export const StatusTagSchema = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/);

/** Any named condition on a character. Harm is a status with a level. */
export const StatusSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80), // e.g. "Deep Cut to Arm"
  kind: z.enum(['harm', 'condition']),
  level: HarmLevelSchema.optional(), // required when kind is 'harm'
  tags: z.array(StatusTagSchema),
  note: z.string().max(500).optional(),
  permanent: z.boolean(), // never heals (RUL §6.5)
  treated: z.boolean(), // harm only: heals at the treated rate
  inflictedAt: GameTimeSchema,
  changedAt: GameTimeSchema, // when the level last changed; starts the healing timer
});
export type Status = z.infer<typeof StatusSchema>;

export const ConsequenceTypeSchema = z.enum([
  'reduced-effect',
  'complication',
  'lost-opportunity',
  'worse-position',
  'harm',
]);
export type ConsequenceType = z.infer<typeof ConsequenceTypeSchema>;

/** What a planned consequence can be: a cost (above), or something the actor achieves. */
export const PlannedConsequenceTypeSchema = z.enum([
  'progress', // the actor achieves something; may tick a clock
  'treatment', // the actor treats a character's harm
  'reduced-effect',
  'complication',
  'lost-opportunity',
  'worse-position',
  'harm',
]);
export type PlannedConsequenceType = z.infer<typeof PlannedConsequenceTypeSchema>;

export const ClockIdSchema = z.string().regex(/^clock\.[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const ClockSchema = z.object({
  id: ClockIdSchema, // e.g. clock.guard-alert
  name: z.string().min(1).max(80),
  segments: z.int().min(2).max(24),
  filled: z.int().nonnegative(),
  visibility: z.enum(['player', 'gm']),
  ownerId: EntityIdSchema.optional(),
  kind: z.enum(['progress', 'stat-change']),
  statChange: z
    .object({
      characterId: EntityIdSchema,
      stat: StatIdSchema,
      delta: z.int().min(-3).max(3), // non-zero
    })
    .optional(), // required when kind is 'stat-change'
});
export type Clock = z.infer<typeof ClockSchema>;
