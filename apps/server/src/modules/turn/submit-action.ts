// Submitting an action (06-turn-engine §5.1, §5.7, §9). Phase 1 takes in-character input
// only: the turn is inserted with its input set as the branch's new head, `narrating`,
// and its narration starts in the background. The checks and the insert run with no
// `await` between them, so two submits can never both pass the waiting rules.
import {
  type AppError,
  type Branch,
  err,
  ok,
  type Result,
  type Turn,
  type TurnStatus,
} from '@mythos/contracts';
import { type Database, insertTurn, type NewCommitSet, readBranch, readTurn } from '../storage';
import type { Narrations, SubmitActionCommand, TurnDeps } from './deps';
import { checkSet, foldAtPoint, pointBefore, stored } from './read-point';

/** Head statuses a new action may follow (TRN-058). */
const READY_STATUSES: readonly TurnStatus[] = [
  'complete',
  'extraction-failed',
  'world-tick-failed',
];

const OOC_MESSAGE = 'Out-of-character input arrives with adjudication in phase 3.';

/** A `validation_failed` error with one issue at `path` (CON-091). */
export function refused(path: string, message: string): AppError {
  return { code: 'validation_failed', message, details: { issues: [{ path, message }] } };
}

/**
 * A branch and its head, if the head is the one the command expects; otherwise
 * `conflict`, and the client refetches (TRN-120). An unknown branch is `not_found`.
 */
export function expectedHead(
  db: Database,
  branchId: string,
  expectedHeadTurnId: string,
): Result<{ branch: Branch; head: Turn }, AppError> {
  const branch = readBranch(db, branchId);
  if (branch === null) {
    return err({ code: 'not_found', message: `There is no branch ${branchId}.` });
  }
  if (branch.headTurnId !== expectedHeadTurnId) {
    const message =
      'The branch has moved on since this command was sent: refetch it and try again.';
    return err({ code: 'conflict', message });
  }
  const head = stored(db, readTurn(db, branch.headTurnId), `turn ${branch.headTurnId}`);
  return ok({ branch, head });
}

/** Why a new action has to wait, in the player's words. */
function waitingMessage(status: TurnStatus): string {
  if (status === 'stage-failed') return 'The last turn failed: retry it or cancel it first.';
  if (status === 'narrating') return 'The GM is still narrating the last turn.';
  return 'The last turn is still being worked on.';
}

/**
 * Whether the campaign can take a new action: its head has finished (TRN-058), and no
 * narration of the campaign is running (ARCH-070). Otherwise `turn_in_progress`.
 */
export function readyForAction(
  narrations: Pick<Narrations, 'inFlight'>,
  campaignId: string,
  head: Turn,
): Result<void, AppError> {
  const inFlight = narrations.inFlight(campaignId);
  if (READY_STATUSES.includes(head.status) && !inFlight) return ok(undefined);
  const status = inFlight ? 'narrating' : head.status;
  return err({ code: 'turn_in_progress', message: waitingMessage(status) });
}

/** The input set: one `input.set`, by the player (TRN-030). */
function inputSetFor(
  deps: TurnDeps,
  turnId: string,
  text: string,
  createdAt: string,
): NewCommitSet {
  return {
    set: {
      id: deps.newId(),
      turnId,
      stage: 'input',
      origin: 'player',
      supersedesSetId: null,
      basedOnSetIds: [],
      copiedFromSetId: null,
      schemaVersion: 1,
      createdAt,
    },
    commits: [{ id: deps.newId(), payload: { type: 'input.set', mode: 'ic', text } }],
  };
}

/**
 * Accepts an in-character action at the head of a branch and starts its narration,
 * returning the new turn's ID as soon as it is stored (TRN-130). Implements TRN-011,
 * TRN-030, TRN-058, TRN-120, and ARCH-070.
 */
export function submitAction(
  deps: TurnDeps,
  campaignId: string,
  command: SubmitActionCommand,
): Result<{ turnId: string }, AppError> {
  if (command.mode === 'ooc') return err(refused('mode', OOC_MESSAGE));
  const opened = deps.store.openCampaign(campaignId);
  if (!opened.ok) return opened;
  const db = opened.value;
  const checked = expectedHead(db, command.branchId, command.expectedHeadTurnId);
  if (!checked.ok) return checked;
  const { head } = checked.value;
  const ready = readyForAction(deps.narrations, campaignId, head);
  if (!ready.ok) return ready;

  // The new turn starts at the head's game time; its input is checked there (TRN-070).
  const { state, context } = foldAtPoint(
    deps.store,
    db,
    pointBefore(command.branchId, head.id, 'end'),
  );
  const turnId = deps.newId();
  const createdAt = new Date(deps.timeSource.now()).toISOString();
  const inputSet = inputSetFor(deps, turnId, command.text, createdAt);
  const valid = checkSet(state, context, inputSet);
  if (!valid.ok) return valid;
  const turn: Turn = {
    id: turnId,
    parentTurnId: head.id,
    depth: head.depth + 1,
    status: 'narrating',
    gameTimeStart: state.world.gameTime,
    copiedFromTurnId: null,
    createdAt,
  };
  // Implements TRN-011: the turn, its input, and the new head in one transaction.
  insertTurn(db, { branchId: command.branchId, turn, sets: [inputSet] });
  deps.store.touchLastPlayed(db);
  deps.publish(campaignId, { type: 'turn.created', branchId: command.branchId, turnId });
  deps.publish(campaignId, { type: 'turn.status', turnId, status: 'narrating' });
  const basedOnSetId = inputSet.set.id;
  deps.narrations.start({ campaignId, branchId: command.branchId, turnId, basedOnSetId });
  return ok({ turnId });
}
