// The narration stage (06-turn-engine §5.4): build the narrator's prompt at the turn's
// read point, stream it through `streamText`, forward each delta to the client, and
// commit what arrived. Narration is an interactive job, never persisted (PRV-061), so
// the narrations in flight, their text so far, and their Stop controls live here, in
// one closure per process (ARCH-022).
import { type AppError, ok, type Result, type TimeSource } from '@mythos/contracts';
import { type ContextDependencies, createContextBuilder } from '../context';
import type { StreamText } from '../providers';
import {
  abandonTurn,
  appendSet,
  type CampaignStore,
  type Database,
  type NewCommitSet,
  readTurn,
  setTurnStatus,
} from '../storage';
import type { NarrationStart, Narrations, Publish, TurnLogger } from './deps';
import {
  fitDelta,
  NARRATION_MAX_CHARS,
  type NarrationOutcome,
  narrationOutcome,
  type StreamEnd,
} from './narration-outcome';
import { checkSet, foldAtPoint, pointBefore } from './read-point';

export type NarrationDeps = {
  store: CampaignStore;
  publish: Publish;
  /** The providers module's `streamText` (05-providers §5). */
  streamText: StreamText;
  /** What the context module needs to build the narrator's prompt (CTX-110). */
  context: ContextDependencies;
  timeSource: TimeSource;
  newId: () => string;
  logger: TurnLogger;
};

/** One narration in flight. */
type Running = NarrationStart & {
  /** Every character forwarded to the client so far: the only text ever committed. */
  text: string;
  /** True once the text reached `NARRATION_MAX_CHARS` and the rest was dropped. */
  cut: boolean;
  /** True when the player pressed Stop, rather than the server shutting down. */
  stoppedByPlayer: boolean;
  controller: AbortController;
  /** Settles, never rejecting, once the turn's status is final. */
  done: Promise<void>;
};

const UNEXPECTED: AppError = {
  code: 'internal_error',
  message: 'Narration failed unexpectedly. Retry the turn.',
};

function openDb(store: CampaignStore, campaignId: string): Database {
  const opened = store.openCampaign(campaignId);
  if (!opened.ok) throw new Error(`campaign ${campaignId} would not open: ${opened.error.message}`);
  return opened.value;
}

/** The narrations in flight in this process, and the runner that settles each one. */
export function createNarrations(deps: NarrationDeps): Narrations {
  const runs = new Map<string, Running>();
  let stopped = false;
  const now = () => new Date(deps.timeSource.now()).toISOString();

  /** Sends one delta to the client at its offset, up to the cap (PRV-045, UI-101). */
  function forward(running: Running, delta: string): void {
    if (running.cut) return;
    const piece = fitDelta(delta, NARRATION_MAX_CHARS - running.text.length);
    if (piece.length > 0) {
      const { campaignId, turnId } = running;
      const offset = running.text.length;
      deps.publish(campaignId, { type: 'narration.delta', turnId, offset, text: piece });
      running.text += piece;
    }
    if (piece.length < delta.length) {
      // The rest would not fit in narration.set: stop the model, as a length stop would.
      running.cut = true;
      running.controller.abort();
    }
  }

  async function streamNarration(running: Running): Promise<StreamEnd> {
    const { campaignId, branchId, turnId } = running;
    const builder = createContextBuilder({
      dependencies: deps.context,
      store: deps.store,
      campaignId,
    });
    // Implements TRN-050 and CTX-076: the prompt at the turn's narration read point;
    // the root turn's opens the story.
    const point = pointBefore(branchId, turnId, 'narration');
    const prompt = await builder.narration(point, turnId, [], null);
    if (!prompt.ok) return { type: 'prompt-failed', error: prompt.error };
    if (running.controller.signal.aborted) return { type: 'stopped-before-call' };
    const { messages, tiers, retrieved, templates } = prompt.value;
    const result = await deps.streamText({
      role: 'narrator',
      messages,
      report: { tiers, retrieved, templates },
      campaignId,
      turnId,
      // Implements PRV-061: Stop aborts this signal, which cancels the interactive job.
      signal: running.controller.signal,
      onDelta: (delta) => {
        forward(running, delta);
      },
      job: null,
    });
    return { type: 'streamed', result };
  }

  /** Writes the narration set and the turn's `complete` status together (TRN-051, TRN-123). */
  function commitNarration(
    db: Database,
    running: Running,
    complete: boolean,
  ): Result<void, AppError> {
    const { branchId, turnId } = running;
    const narrationSet: NewCommitSet = {
      set: {
        id: deps.newId(),
        turnId,
        stage: 'narration',
        origin: 'model',
        supersedesSetId: null,
        basedOnSetIds: [running.basedOnSetId],
        copiedFromSetId: null,
        schemaVersion: 1,
        createdAt: now(),
      },
      commits: [
        { id: deps.newId(), payload: { type: 'narration.set', text: running.text, complete } },
      ],
    };
    const { state, context } = foldAtPoint(
      deps.store,
      db,
      pointBefore(branchId, turnId, 'narration'),
    );
    const valid = checkSet(state, context, narrationSet);
    if (!valid.ok) return valid;
    appendSet(db, narrationSet, 'complete');
    return ok(undefined);
  }

  /** Leaves the turn `stage-failed`, with the error shown when there is one (TRN-052). */
  function failStage(db: Database, running: Running, error: AppError | null): void {
    const { campaignId, turnId } = running;
    setTurnStatus(db, turnId, 'stage-failed');
    runs.delete(turnId);
    deps.publish(campaignId, { type: 'turn.status', turnId, status: 'stage-failed' });
    if (error !== null) deps.publish(campaignId, { type: 'error', turnId, error });
    const reason =
      error === null ? { code: 'cancelled' } : { code: error.code, error: error.message };
    deps.logger.warn({ campaignId, turnId, ...reason }, 'narration failed');
  }

  function settle(running: Running, outcome: NarrationOutcome): void {
    const { campaignId, turnId } = running;
    const db = openDb(deps.store, campaignId);
    if (outcome.type === 'fail') {
      failStage(db, running, outcome.error);
      return;
    }
    if (outcome.type === 'stopped') {
      // Implements TRN-149: nothing arrived, so there is nothing to keep. The root turn
      // has no input to give back, and a shutdown is not the player's choice.
      const isRoot = readTurn(db, turnId)?.parentTurnId === null;
      if (!running.stoppedByPlayer || isRoot) {
        failStage(db, running, null);
        return;
      }
      // Implements TRN-047: the head moves back, and the input is returned in the view.
      abandonTurn(db, running.branchId, turnId);
      runs.delete(turnId);
      deps.publish(campaignId, { type: 'turn.status', turnId, status: 'abandoned' });
      deps.logger.info({ campaignId, turnId }, 'turn abandoned');
      return;
    }
    const committed = commitNarration(db, running, outcome.complete);
    if (!committed.ok) {
      failStage(db, running, committed.error);
      return;
    }
    runs.delete(turnId);
    deps.publish(campaignId, { type: 'narration.done', turnId });
    deps.publish(campaignId, { type: 'turn.status', turnId, status: 'complete' });
    // Implements TRN-052: text cut short by a failure is kept, and the error shown.
    if (outcome.error !== null) {
      deps.publish(campaignId, { type: 'error', turnId, error: outcome.error });
    }
    const fields = {
      campaignId,
      turnId,
      complete: outcome.complete,
      characters: running.text.length,
    };
    deps.logger.info(fields, 'narration committed');
  }

  /** After an unexpected throw: a turn still narrating becomes `stage-failed`. */
  function recover(running: Running, thrown: unknown): void {
    const { campaignId, turnId } = running;
    deps.logger.error({ campaignId, turnId, err: thrown }, 'narration failed unexpectedly');
    try {
      const db = openDb(deps.store, campaignId);
      if (readTurn(db, turnId)?.status === 'narrating') failStage(db, running, UNEXPECTED);
    } catch (again) {
      deps.logger.error({ campaignId, turnId, err: again }, 'could not mark the turn stage-failed');
    }
  }

  async function run(running: Running): Promise<void> {
    try {
      const end = await streamNarration(running);
      settle(running, narrationOutcome(end, running.text, running.cut));
    } catch (thrown) {
      recover(running, thrown);
    } finally {
      runs.delete(running.turnId);
    }
  }

  return {
    start(narration) {
      if (stopped) throw new Error('narrations.start: the server is shutting down');
      if (runs.has(narration.turnId)) {
        throw new Error(`narrations.start: turn ${narration.turnId} is already narrating`);
      }
      const running: Running = {
        ...narration,
        text: '',
        cut: false,
        stoppedByPlayer: false,
        controller: new AbortController(),
        done: Promise.resolve(),
      };
      runs.set(narration.turnId, running);
      running.done = run(running);
    },
    async cancel(turnId) {
      const running = runs.get(turnId);
      if (running === undefined) return;
      running.stoppedByPlayer = true;
      running.controller.abort();
      await running.done;
    },
    textSoFar: (turnId) => runs.get(turnId)?.text ?? null,
    inFlight: (campaignId) => [...runs.values()].some((run) => run.campaignId === campaignId),
    async stop() {
      stopped = true;
      const all = [...runs.values()];
      for (const running of all) running.controller.abort();
      await Promise.all(all.map((running) => running.done));
    },
  };
}
