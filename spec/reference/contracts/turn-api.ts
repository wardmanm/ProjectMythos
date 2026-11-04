import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './primitives';
import {
  ClockIdSchema,
  EffectLevelSchema,
  HarmLevelSchema,
  RollResultSchema,
  RollSchema,
  StatIdSchema,
  StatRatingSchema,
} from './rules';
import { PlannedConsequenceSchema, RulingSchema } from './ruling';
import { CommitPayloadSchema, CommitStageSchema } from './commits';
import { BranchSchema, InputModeSchema, TurnSchema } from './turns';
import { CalendarDateSchema } from './content/calendar';

// ---------------------------------------------------------------------------
// Resolution draft — server-held, shown to the player before resolution commits
// ---------------------------------------------------------------------------

/** A resistance roll against one harm consequence (RUL §6.3). */
export const ResistanceRollSchema = z.object({
  consequenceIndex: z.int().nonnegative(), // index into `consequences`
  roll: RollSchema,
  levelsReduced: z.int().min(0).max(9), // reducing to 0 negates the harm
});

/** How one harm consequence was processed, step by step (RUL §6). Levels: 0 = none. */
export const HarmResultSchema = z.object({
  consequenceIndex: z.int().nonnegative(),
  targetId: EntityIdSchema,
  plannedLevel: HarmLevelSchema, // as the GM wrote it
  scaledLevel: HarmLevelSchema, // after effect scaling (success-tier harm on roll rulings)
  armor: z.object({ itemId: EntityIdSchema, toLevel: z.int().min(0).max(9) }).nullable(),
  resistanceIndex: z.int().nonnegative().nullable(), // into `resistanceRolls`
  finalLevel: z.int().min(0).max(9), // after armor and resistance
  placedLevel: HarmLevelSchema.nullable(), // after overflow; null when negated
  outcome: z.enum(['negated', 'placed', 'fatal', 'survived-fatal', 'capped']),
});
export type HarmResult = z.infer<typeof HarmResultSchema>;

/** A clock change the draft will apply (RUL §7). Hidden clocks appear only in GM mode. */
export const ClockResultSchema = z.object({
  clockId: ClockIdSchema,
  from: z.int().nonnegative(),
  to: z.int().nonnegative(),
  segments: z.int().min(2).max(12),
  completed: z.boolean(),
  created: z.boolean(),
});

/**
 * The pending outcome of a turn. Persisted (not as commits) so a restart does not reroll.
 * Accepting it writes the resolution commit set (TRN §5).
 */
export const ResolutionDraftSchema = z.object({
  turnId: IdSchema,
  rulingSetId: IdSchema,
  actionRoll: RollSchema.nullable(), // null for direct and OOC rulings
  outcome: RollResultSchema, // from the roll, or from a direct ruling
  effect: EffectLevelSchema,
  consequences: z.array(PlannedConsequenceSchema), // the selected tier's, possibly edited
  resistanceRolls: z.array(ResistanceRollSchema),
  harmResults: z.array(HarmResultSchema),
  clockResults: z.array(ClockResultSchema),
  statChanges: z.array(
    z.object({
      characterId: EntityIdSchema,
      stat: StatIdSchema,
      from: StatRatingSchema,
      to: StatRatingSchema,
    }),
  ),
  /** Harm healed by the time this turn takes (RUL §6.6). */
  healing: z.array(
    z.object({
      characterId: EntityIdSchema,
      harmName: z.string(),
      fromLevel: HarmLevelSchema,
      toLevel: HarmLevelSchema.nullable(),
    }),
  ),
  invalidConsequences: z.array(z.object({ index: z.int().nonnegative(), reason: z.string() })), // TRN-045
  elapsedMinutes: z.int().nonnegative(),
  overridden: z.boolean(), // any player change: reroll, outcome, consequences
  requiresResponse: z.boolean(), // false when the ruleset auto-accepts (TRN-043)
});
export type ResolutionDraft = z.infer<typeof ResolutionDraftSchema>;

// ---------------------------------------------------------------------------
// Commands (client → server)
// ---------------------------------------------------------------------------

/** Required when the target turn is not the branch head (TRN §7). */
export const HistoryModeSchema = z.enum(['rewrite', 'retcon']);
export type HistoryMode = z.infer<typeof HistoryModeSchema>;

/** Every command that changes a branch carries the head it expects (TRN-120). */
const BranchGuard = { branchId: IdSchema, expectedHeadTurnId: IdSchema };

export const SubmitActionCommandSchema = z.object({
  ...BranchGuard,
  mode: InputModeSchema,
  text: z.string().min(1).max(8000),
});

export const ResolveCommandSchema = z.object({
  ...BranchGuard,
  turnId: IdSchema,
  action: z.discriminatedUnion('action', [
    z.object({ action: z.literal('accept') }),
    z.object({ action: z.literal('reroll-action') }),
    z.object({ action: z.literal('reroll-resistance'), resistanceIndex: z.int().nonnegative() }),
    z.object({
      action: z.literal('set-outcome'),
      outcome: RollResultSchema,
      effect: EffectLevelSchema.optional(),
    }),
    z.object({
      action: z.literal('edit-consequences'),
      consequences: z.array(PlannedConsequenceSchema),
    }),
    z.object({ action: z.literal('cancel') }), // abandons the turn (TRN-047)
  ]),
});

export const StageEditSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('input'), mode: InputModeSchema, text: z.string().min(1).max(8000) }),
  z.object({ stage: z.literal('adjudication'), ruling: RulingSchema }),
  z.object({
    stage: z.literal('resolution'),
    outcome: RollResultSchema,
    effect: EffectLevelSchema,
    consequences: z.array(PlannedConsequenceSchema),
  }),
  z.object({ stage: z.literal('narration'), text: z.string().max(20000) }),
]);

const HistoryOptions = {
  historyMode: HistoryModeSchema.optional(),
  /** When false, downstream stages are left stale for the player to handle (TRN-085). */
  regenerateDownstream: z.boolean().default(true),
};

export const EditStageCommandSchema = z.object({
  ...BranchGuard,
  turnId: IdSchema,
  edit: StageEditSchema,
  ...HistoryOptions,
});

export const RegenerateStageCommandSchema = z.object({
  ...BranchGuard,
  turnId: IdSchema,
  stage: z.enum(['adjudication', 'resolution', 'narration', 'extraction']),
  instruction: z.string().min(1).max(2000).optional(), // "regenerate with instruction"
  profileId: z.string().optional(), // "regenerate with…" another model (PRV-007)
  ...HistoryOptions,
});

/** Player edits to world state, memory, or the journal. Defaults to the head turn. */
export const EditStateCommandSchema = z.object({
  ...BranchGuard,
  turnId: IdSchema.optional(),
  commits: z.array(CommitPayloadSchema).min(1).max(200),
  historyMode: HistoryModeSchema.optional(),
});

/** Supersede a stage's active set with a copy of an older version of it (TRN-116). */
export const RestoreVersionCommandSchema = z.object({
  ...BranchGuard,
  setId: IdSchema,
  ...HistoryOptions,
});

/** Accept a stale stage as it is (§7.1). */
export const KeepStaleCommandSchema = z.object({
  ...BranchGuard,
  turnId: IdSchema,
  stage: CommitStageSchema,
});

export const RewindCommandSchema = z.object({ ...BranchGuard, toTurnId: IdSchema });

export const ForkCommandSchema = z.object({
  fromTurnId: IdSchema,
  name: z.string().min(1).max(80),
  switchTo: z.boolean().default(true),
});

export const CancelCommandSchema = z.object({ turnId: IdSchema });

/** Skip time without a model ruling, or with an activity the GM adjudicates (TIME-040). */
export const SkipTimeCommandSchema = z.object({
  ...BranchGuard,
  until: z.discriminatedUnion('type', [
    z.object({ type: z.literal('time-of-day'), name: z.string().min(1) }), // next start of it
    z.object({ type: z.literal('duration'), minutes: z.int().min(1).max(5_256_000) }), // ≤ 10 years
    z.object({ type: z.literal('date'), date: CalendarDateSchema }),
  ]),
  activity: z.string().min(1).max(500).optional(), // e.g. "training with the harbor guard"
});

// ---------------------------------------------------------------------------
// Read model (server → client)
// ---------------------------------------------------------------------------

export const ResolutionViewSchema = z.object({
  rolls: z.array(z.object({ purpose: z.enum(['action', 'resistance']), roll: RollSchema })),
  outcome: RollResultSchema,
  effect: EffectLevelSchema,
  consequences: z.array(PlannedConsequenceSchema),
  overridden: z.boolean(),
});

/** One turn as the client displays it. Built from the turn's active sets. */
export const TurnViewSchema = z.object({
  turn: TurnSchema,
  gameTimeLabel: z.string(), // formatted with the campaign calendar
  input: z.object({ mode: InputModeSchema, text: z.string() }).nullable(),
  /** Ruling with explanations filtered to what the current explanation level allows (TRN-081). */
  ruling: RulingSchema.nullable(),
  visibleExplanation: z.string().nullable(),
  draft: ResolutionDraftSchema.nullable(), // present while status is awaiting-resolution
  resolution: ResolutionViewSchema.nullable(),
  narration: z.object({ text: z.string(), complete: z.boolean() }).nullable(),
  staleStages: z.array(CommitStageSchema),
  failedStages: z.array(z.enum(['adjudication', 'narration', 'extraction', 'world-tick'])),
  replayConflictCount: z.int().nonnegative(),
  /** After a time skip: what the PC learned off-screen, from this turn's world ticks (TIME-100). */
  offscreen: z
    .object({
      periodLabel: z.string(), // e.g. "October 12 – November 11, 1874"
      items: z.array(z.object({ gameTimeLabel: z.string(), text: z.string() })),
    })
    .nullable(),
  /** Number of versions per stage, including the active one. */
  versionCounts: z.partialRecord(CommitStageSchema, z.int().positive()),
  sharedWithOtherBranches: z.boolean(), // editing will copy-on-write (CON-088)
  bookmarkNames: z.array(z.string()),
});
export type TurnView = z.infer<typeof TurnViewSchema>;

export const BranchViewSchema = z.object({
  branch: BranchSchema,
  headDepth: z.int().nonnegative(),
  isCurrent: z.boolean(),
});

/** A commit skipped during replay because it no longer validates (TRN-071). */
export const ReplayConflictSchema = z.object({
  turnId: IdSchema,
  setId: IdSchema,
  commitId: IdSchema,
  commitType: z.string(),
  reason: z.string(),
  entityIds: z.array(EntityIdSchema),
});
export type ReplayConflict = z.infer<typeof ReplayConflictSchema>;
