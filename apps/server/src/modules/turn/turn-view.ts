// What the play screen shows of turns and branches (06-turn-engine §12). Phase 1 fills a
// turn's record, its date, its input, and its narration; every other part of a
// `TurnView` waits for its phase and is empty or zero (06-turn-engine §11).
import {
  type AppError,
  type BranchViewSchema,
  err,
  ok,
  type Result,
  type Turn,
  type TurnView,
} from '@mythos/contracts';
import type { z } from 'zod';
import {
  type CampaignStore,
  type Database,
  listBranches,
  readBranch,
  readState,
  readTurn,
  readTurnSets,
  readTurnsOnBranch,
} from '../storage';
import { gameTimeLabeller } from './campaign-view';
import type { Narrations } from './deps';
import { stored } from './read-point';

export type BranchView = z.infer<typeof BranchViewSchema>;

/** What the views read: the store, and the text of narrations still streaming. */
export type ViewDeps = { store: CampaignStore; narrations: Pick<Narrations, 'textSoFar'> };

/** A turn's input and narration, read from its active sets (CON-060). */
function contentOf(db: Database, turnId: string): Pick<TurnView, 'input' | 'narration'> {
  let input: TurnView['input'] = null;
  let narration: TurnView['narration'] = null;
  for (const { commits } of readTurnSets(db, turnId)) {
    for (const { payload } of commits) {
      if (payload.type === 'input.set') input = { mode: payload.mode, text: payload.text };
      if (payload.type === 'narration.set') {
        narration = { text: payload.text, complete: payload.complete };
      }
    }
  }
  return { input, narration };
}

function viewOf(
  deps: ViewDeps,
  db: Database,
  turn: Turn,
  label: (gameTime: number) => string,
): TurnView {
  const { input, narration } = contentOf(db, turn.id);
  // Implements TRN-150: while narration streams, the text so far, marked incomplete.
  const streamed = turn.status === 'narrating' ? deps.narrations.textSoFar(turn.id) : null;
  return {
    turn,
    gameTimeLabel: label(turn.gameTimeStart),
    input,
    ruling: null,
    visibleExplanation: null,
    draft: null,
    resolution: null,
    narration: streamed === null ? narration : { text: streamed, complete: false },
    staleStages: [],
    failedStages: [],
    replayConflictCount: 0,
    offscreen: null,
    versionCounts: {},
    sharedWithOtherBranches: false,
    bookmarkNames: [],
  };
}

/** One turn as the client shows it, on a branch or abandoned, or `not_found`. */
export function turnView(
  deps: ViewDeps,
  campaignId: string,
  turnId: string,
): Result<TurnView, AppError> {
  const opened = deps.store.openCampaign(campaignId);
  if (!opened.ok) return opened;
  const db = opened.value;
  const turn = readTurn(db, turnId);
  if (turn === null) return err({ code: 'not_found', message: `There is no turn ${turnId}.` });
  return ok(viewOf(deps, db, turn, gameTimeLabeller(deps.store, db)));
}

/**
 * Up to `limit` turns of a branch below `beforeDepth` (null: up to its head), oldest
 * first, as `GET /branches/:branchId/turns` returns them (06-turn-engine §10).
 */
export function turnViews(
  deps: ViewDeps,
  campaignId: string,
  branchId: string,
  page: { beforeDepth: number | null; limit: number },
): Result<TurnView[], AppError> {
  const opened = deps.store.openCampaign(campaignId);
  if (!opened.ok) return opened;
  const db = opened.value;
  if (readBranch(db, branchId) === null) {
    return err({ code: 'not_found', message: `There is no branch ${branchId}.` });
  }
  const label = gameTimeLabeller(deps.store, db);
  const turns = readTurnsOnBranch(db, branchId, page.beforeDepth, page.limit);
  return ok(turns.map((turn) => viewOf(deps, db, turn, label)));
}

/** Every branch of the campaign, in creation order, as `GET /branches` returns them. */
export function branchViews(
  store: CampaignStore,
  campaignId: string,
): Result<BranchView[], AppError> {
  const opened = store.openCampaign(campaignId);
  if (!opened.ok) return opened;
  const db = opened.value;
  const currentBranchId = readState(db, 'current_branch_id');
  return ok(
    listBranches(db).map((branch) => ({
      branch,
      headDepth: stored(db, readTurn(db, branch.headTurnId), `turn ${branch.headTurnId}`).depth,
      isCurrent: branch.id === currentBranchId,
    })),
  );
}
