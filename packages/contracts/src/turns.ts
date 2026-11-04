import { z } from 'zod';
import { GameTimeSchema, IdSchema, WallTimeSchema } from './primitives';

export const InputModeSchema = z.enum(['ic', 'ooc']);
export type InputMode = z.infer<typeof InputModeSchema>;

export const TurnStatusSchema = z.enum([
  'adjudicating',
  'awaiting-resolution', // ruling or roll shown; waiting on player accept/reroll/override
  'narrating',
  'extracting',
  'complete',
  'world-ticking', // off-screen simulation for the time this turn advanced (TIME §5)
  'extraction-failed', // playable, but memories for this turn are missing
  'world-tick-failed', // playable, but some off-screen periods were not simulated
  'stage-failed', // adjudication or narration failed; waiting for the player to choose a fix
  'abandoned', // cancelled before resolution was accepted; unreachable from any branch
]);
export type TurnStatus = z.infer<typeof TurnStatusSchema>;

/**
 * The structural record of a turn. A turn's content (input, ruling, roll, narration,
 * state changes) is stored as commits so every part is editable and versioned.
 */
export const TurnSchema = z.object({
  id: IdSchema,
  parentTurnId: IdSchema.nullable(), // null only for the campaign's first turn
  depth: z.int().nonnegative(),
  status: TurnStatusSchema,
  gameTimeStart: GameTimeSchema,
  copiedFromTurnId: IdSchema.nullable(), // set when created by copy-on-write (CON-088)
  createdAt: WallTimeSchema,
});
export type Turn = z.infer<typeof TurnSchema>;

export const BranchSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  headTurnId: IdSchema,
  forkedFromTurnId: IdSchema.nullable(),
  archived: z.boolean(), // hidden by default; created by rewrite or by the player
  createdAt: WallTimeSchema,
});
export type Branch = z.infer<typeof BranchSchema>;

export const BookmarkSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  turnId: IdSchema,
});
export type Bookmark = z.infer<typeof BookmarkSchema>;

/**
 * Where a read happens (TRN-060): the ancestry of `turnId` on `branchId`, up to the
 * parent turn, plus the turn's own active sets of stages before `beforeStage`. During
 * play, reads use the head turn and the stage about to run.
 */
export const ReadPointSchema = z.object({
  branchId: IdSchema,
  turnId: IdSchema,
  beforeStage: z.enum([
    'adjudication',
    'resolution',
    'narration',
    'extraction',
    'world-tick',
    'consolidation',
    'end', // after every stage of the turn
  ]),
  /** With beforeStage 'world-tick': how many of this turn's world-tick sets to include (TIME-053). */
  worldTicksBefore: z.int().nonnegative().optional(),
});
export type ReadPoint = z.infer<typeof ReadPointSchema>;
