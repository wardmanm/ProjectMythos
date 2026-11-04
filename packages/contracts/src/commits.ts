import { z } from 'zod';
import {
  EntityIdSchema,
  GameTimeSchema,
  IdSchema,
  SchemaVersionSchema,
  WallTimeSchema,
} from './primitives';
import { EntitySchema, ItemLocationSchema } from './entities';
import {
  ClockIdSchema,
  ClockSchema,
  EffectLevelSchema,
  HarmLevelSchema,
  RollResultSchema,
  RollSchema,
  StatIdSchema,
  StatRatingSchema,
  StatusSchema,
  StatusTagSchema,
} from './rules';
import { PlannedConsequenceSchema, RulingSchema } from './ruling';
import { InputModeSchema } from './turns';
import {
  BeliefSchema,
  KnowledgeGrantSchema,
  NoteSchema,
  ObservationSchema,
  RelationshipValueSchema,
} from './memory';
import { FlagValueSchema } from './world-state';

// ---------------------------------------------------------------------------
// Commit sets
// ---------------------------------------------------------------------------

/** Which part of the turn pipeline (or which background process) produced a set. */
export const CommitStageSchema = z.enum([
  'setup', // root turn only: campaign creation (SCH-112)
  'input',
  'adjudication',
  'resolution',
  'narration',
  'extraction',
  'world-tick',
  'consolidation',
  'player-edit',
]);
export type CommitStage = z.infer<typeof CommitStageSchema>;

/** Who authored the content of the set. */
export const CommitOriginSchema = z.enum(['player', 'model', 'engine']);

/**
 * A group of commits applied atomically (ARCH-041). Editing or regenerating any part
 * of a turn creates a new set that supersedes the old one; the old set stays in the
 * log but is inactive. Player edits and background sets do not supersede by default.
 */
export const CommitSetSchema = z.object({
  id: IdSchema,
  turnId: IdSchema,
  stage: CommitStageSchema,
  origin: CommitOriginSchema,
  supersedesSetId: IdSchema.nullable(),
  /** Upstream sets this set was generated from. Superseding any of them makes this set stale. */
  basedOnSetIds: z.array(IdSchema),
  copiedFromSetId: IdSchema.nullable(), // set when created by copy-on-write
  schemaVersion: SchemaVersionSchema,
  /** Campaign-wide creation order, assigned by storage; orders sets within a stage (CON-084). */
  seq: z.int().nonnegative(),
  createdAt: WallTimeSchema,
});
export type CommitSet = z.infer<typeof CommitSetSchema>;

// ---------------------------------------------------------------------------
// Commit payloads — turn content
// ---------------------------------------------------------------------------

const InputSet = z.object({
  type: z.literal('input.set'),
  mode: InputModeSchema,
  text: z.string().min(1).max(8000),
});
const RulingSet = z.object({ type: z.literal('ruling.set'), ruling: RulingSchema });
const RollRecord = z.object({
  type: z.literal('roll.record'),
  roll: RollSchema,
  purpose: z.enum(['action', 'resistance']),
});
const NarrationSet = z.object({
  type: z.literal('narration.set'),
  text: z.string().max(20000),
  complete: z.boolean(), // false when generation was cancelled or cut off (PRV-047)
});
/** The final outcome of a turn's resolution, after overrides and scaling (RUL §4). */
const ResolutionRecord = z.object({
  type: z.literal('resolution.record'),
  outcome: RollResultSchema,
  effect: EffectLevelSchema,
  consequences: z.array(PlannedConsequenceSchema), // as applied
});
const OverrideRecord = z.object({
  type: z.literal('override.record'),
  target: z.enum(['input', 'ruling', 'roll', 'narration', 'state', 'memory']),
  instruction: z.string().max(2000).nullable(), // player's regenerate-with-instruction text
});

// ---------------------------------------------------------------------------
// Commit payloads — world state
// ---------------------------------------------------------------------------

const EntityCreate = z.object({ type: z.literal('entity.create'), entity: EntitySchema });
const EntityUpdateNarrative = z.object({
  type: z.literal('entity.update-narrative'),
  entityId: EntityIdSchema,
  fields: z
    .object({
      name: z.string().min(1).max(120),
      aliases: z.array(z.string().max(120)),
      tags: z.array(z.string().max(40)),
      physicalDescription: z.string().max(1000), // characters only
      personality: z.string().max(600), // characters only
      goals: z.array(z.string().min(1).max(200)).max(8), // characters and factions
      keyNpc: z.boolean(), // characters only; player edits only
      description: z.string().max(2000), // places, factions, items
    })
    .partial(),
});
const EntityMove = z.object({
  type: z.literal('entity.move'),
  characterId: EntityIdSchema,
  toPlaceId: EntityIdSchema.nullable(),
});
const EntityDeath = z.object({
  type: z.literal('entity.death'),
  characterId: EntityIdSchema,
  cause: z.string().max(300),
});
const StatChange = z.object({
  type: z.literal('stat.change'),
  characterId: EntityIdSchema,
  stat: StatIdSchema,
  from: StatRatingSchema,
  to: StatRatingSchema,
});
const StatusAdd = z.object({
  type: z.literal('status.add'),
  characterId: EntityIdSchema,
  status: StatusSchema,
});
const StatusUpdate = z.object({
  type: z.literal('status.update'),
  characterId: EntityIdSchema,
  statusId: IdSchema,
  changes: z
    .object({
      name: z.string().min(1).max(80),
      level: HarmLevelSchema,
      tags: z.array(StatusTagSchema),
      note: z.string().max(500),
      permanent: z.boolean(),
      treated: z.boolean(),
      changedAt: GameTimeSchema,
    })
    .partial(),
});
/** Harm lowered before placement, by armor or a resistance roll (RUL §6.3). */
const HarmMitigate = z.object({
  type: z.literal('harm.mitigate'),
  characterId: EntityIdSchema,
  source: z.enum(['armor', 'resistance']),
  itemId: EntityIdSchema.nullable(), // the armor; null for resistance
  harmName: z.string().min(1).max(80),
  fromLevel: HarmLevelSchema,
  toLevel: HarmLevelSchema.nullable(), // null = negated
});
const StatusRemove = z.object({
  type: z.literal('status.remove'),
  characterId: EntityIdSchema,
  statusId: IdSchema,
  reason: z.string().max(300),
});
const ClockCreate = z.object({ type: z.literal('clock.create'), clock: ClockSchema });
const ClockTick = z.object({
  type: z.literal('clock.tick'),
  clockId: ClockIdSchema,
  ticks: z.int().min(-24).max(24),
});
const ClockDelete = z.object({ type: z.literal('clock.delete'), clockId: ClockIdSchema });
const ItemMove = z.object({
  type: z.literal('item.move'),
  itemId: EntityIdSchema,
  to: ItemLocationSchema,
  ownerId: EntityIdSchema.nullable().optional(), // absent = unchanged; null = nobody's
});
/** Sets a stack's size; 0 means used up (location becomes 'gone'). */
const ItemQuantity = z.object({
  type: z.literal('item.quantity'),
  itemId: EntityIdSchema,
  quantity: z.int().min(0).max(9999),
});
const TimeAdvance = z.object({
  type: z.literal('time.advance'),
  minutes: z.int().positive(),
  reason: z.string().max(300),
});
const SceneStart = z.object({
  type: z.literal('scene.start'),
  sceneId: IdSchema,
  placeId: EntityIdSchema,
});
const FlagSet = z.object({
  type: z.literal('flag.set'),
  key: z.string().min(1).max(80),
  value: FlagValueSchema.nullable(),
});

// ---------------------------------------------------------------------------
// Commit payloads — memory
// ---------------------------------------------------------------------------

/** `knowerId` knows `entityId` by `name`: an introduction, a nickname, a descriptor (JRN §3). */
const KnowledgeName = z.object({
  type: z.literal('knowledge.name'),
  knowerId: EntityIdSchema,
  entityId: EntityIdSchema,
  name: z.string().min(1).max(120),
});
/** First commit of every world-tick set: the period it simulated (TIME-054). */
const TickRecord = z.object({
  type: z.literal('tick.record'),
  periodStart: GameTimeSchema,
  periodEnd: GameTimeSchema,
  coarse: z.boolean(),
  actorIds: z.array(EntityIdSchema),
  summary: z.string().max(800),
});
const ObservationAdd = z.object({
  type: z.literal('observation.add'),
  observation: ObservationSchema,
});
const ObservationAmend = z.object({
  type: z.literal('observation.amend'),
  observationId: IdSchema,
  changes: z
    .object({
      text: z.string().min(1).max(1000),
      importance: z.int().min(1).max(10),
      tags: z.array(z.string().max(40)),
      witnessIds: z.array(EntityIdSchema),
      mentionedIds: z.array(EntityIdSchema),
      claimContent: z.string().min(1).max(1000), // claims only: what was said (JRN-041)
    })
    .partial(),
});
const KnowledgeGrantCommit = z.object({
  type: z.literal('knowledge.grant'),
  grant: KnowledgeGrantSchema,
});
const KnowledgeRevoke = z.object({
  type: z.literal('knowledge.revoke'),
  entityId: EntityIdSchema,
  observationId: IdSchema,
});
const RelationshipAdjust = z.object({
  type: z.literal('relationship.adjust'),
  fromId: EntityIdSchema,
  toId: EntityIdSchema,
  deltas: z.record(z.string(), z.int().min(-100).max(100)), // limited by the ruleset; clamped on apply
  summary: z.string().max(600).nullable(), // replaces summary when non-null
  addKeyObservationIds: z.array(IdSchema),
});
const RelationshipSet = z.object({
  type: z.literal('relationship.set'),
  fromId: EntityIdSchema,
  toId: EntityIdSchema,
  dimensions: z.record(z.string(), RelationshipValueSchema), // absolute values; omitted dimensions unchanged
  summary: z.string().max(600).nullable(),
});
const WikiPatch = z.object({
  type: z.literal('wiki.patch'),
  entityId: EntityIdSchema,
  op: z.discriminatedUnion('op', [
    z.object({
      op: z.literal('upsert-section'),
      heading: z.string().min(1).max(80),
      body: z.string().max(4000),
      sourceObservationIds: z.array(IdSchema),
    }),
    z.object({ op: z.literal('remove-section'), heading: z.string().min(1).max(80) }),
  ]),
});

// ---------------------------------------------------------------------------
// Commit payloads — journal
// ---------------------------------------------------------------------------

const NoteUpsert = z.object({ type: z.literal('note.upsert'), note: NoteSchema });
const NoteDelete = z.object({ type: z.literal('note.delete'), noteId: IdSchema });
const BeliefUpsert = z.object({ type: z.literal('belief.upsert'), belief: BeliefSchema });
const BeliefDelete = z.object({ type: z.literal('belief.delete'), beliefId: IdSchema });

export const CommitPayloadSchema = z.discriminatedUnion('type', [
  InputSet,
  RulingSet,
  RollRecord,
  NarrationSet,
  ResolutionRecord,
  OverrideRecord,
  EntityCreate,
  EntityUpdateNarrative,
  EntityMove,
  EntityDeath,
  StatChange,
  StatusAdd,
  StatusUpdate,
  HarmMitigate,
  StatusRemove,
  ClockCreate,
  ClockTick,
  ClockDelete,
  ItemMove,
  ItemQuantity,
  TimeAdvance,
  SceneStart,
  FlagSet,
  TickRecord,
  ObservationAdd,
  ObservationAmend,
  KnowledgeGrantCommit,
  KnowledgeRevoke,
  KnowledgeName,
  RelationshipAdjust,
  RelationshipSet,
  WikiPatch,
  NoteUpsert,
  NoteDelete,
  BeliefUpsert,
  BeliefDelete,
]);
export type CommitPayload = z.infer<typeof CommitPayloadSchema>;
export type CommitType = CommitPayload['type'];

export const CommitSchema = z.object({
  id: IdSchema,
  setId: IdSchema,
  seq: z.int().nonnegative(), // order within the set
  payload: CommitPayloadSchema,
});
export type Commit = z.infer<typeof CommitSchema>;
