// What the turn module's commands are given by the composition root (ARCH-022), and the
// shape of the one stateful part, the narrations in flight.
import type {
  CancelCommandSchema,
  RegenerateStageCommandSchema,
  ServerEventPayload,
  SubmitActionCommandSchema,
  TimeSource,
} from '@mythos/contracts';
import type { z } from 'zod';
import type { CampaignStore } from '../storage';

/** The commands this module takes, as the http module parses them (06-turn-engine §12). */
export type SubmitActionCommand = z.infer<typeof SubmitActionCommandSchema>;
export type CancelCommand = z.infer<typeof CancelCommandSchema>;
export type RegenerateStageCommand = z.infer<typeof RegenerateStageCommandSchema>;

/** The logger methods the module uses; the server's pino logger fits it (CONV-071). */
export type TurnLogger = {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

/** The event bus's `publish`, as a plain function (03-contracts §13). */
export type Publish = (campaignId: string, payload: ServerEventPayload) => unknown;

/** A turn whose narration is to run: the root turn's opening, or a turn with its input. */
export type NarrationStart = {
  campaignId: string;
  branchId: string;
  turnId: string;
  /** The set the narration is based on: the turn's input set, or the root's setup set. */
  basedOnSetId: string;
};

/**
 * The narrations running in this process (`createNarrations`). Narration is an
 * interactive job, never persisted (PRV-061), so what is in flight lives only here.
 */
export type Narrations = {
  /** Starts a turn's narration in the background; the turn is already `narrating`. */
  start: (narration: NarrationStart) => void;
  /** Stops a running narration as the player's Stop, and waits for it to settle. */
  cancel: (turnId: string) => Promise<void>;
  /** The text streamed so far, or null when the turn's narration is not running. */
  textSoFar: (turnId: string) => string | null;
  /** Whether any narration of the campaign is running (ARCH-070). */
  inFlight: (campaignId: string) => boolean;
  /** At shutdown: stops every narration and waits for each to settle. */
  stop: () => Promise<void>;
};

/** Everything a turn command needs. One `narrations` serves the whole process. */
export type TurnDeps = {
  store: CampaignStore;
  publish: Publish;
  /** Wall time, for the records' times (CONV-061). */
  timeSource: TimeSource;
  /** A new UUID on each call; tests pass a seeded one. */
  newId: () => string;
  logger: TurnLogger;
  narrations: Narrations;
};
