// Stop and cancel (06-turn-engine TRN-047, TRN-149). Stop during narration keeps what
// arrived, or abandons the turn when nothing has; cancelling a failed turn abandons it,
// so play can go on (TRN-058). Any other turn is returned as it is: a Stop that arrives
// just as the narration ends is not a mistake.
import { type AppError, err, type Result, type TurnView } from '@mythos/contracts';
import { abandonTurn, listBranches, readTurn } from '../storage';
import type { CancelCommand, TurnDeps } from './deps';
import { turnView } from './turn-view';

/**
 * Stops or cancels a turn and returns its view afterwards: an abandoned turn's view
 * holds its input, for the player to edit and send again (TRN-047). Implements TRN-149
 * and PRV-047.
 */
export async function cancelTurn(
  deps: TurnDeps,
  campaignId: string,
  command: CancelCommand,
): Promise<Result<TurnView, AppError>> {
  const opened = deps.store.openCampaign(campaignId);
  if (!opened.ok) return opened;
  const db = opened.value;
  const turn = readTurn(db, command.turnId);
  if (turn === null) {
    return err({ code: 'not_found', message: `There is no turn ${command.turnId}.` });
  }
  if (deps.narrations.textSoFar(turn.id) !== null) {
    // The narration settles first: committed as it stands, or the turn abandoned.
    await deps.narrations.cancel(turn.id);
  } else if (turn.status === 'stage-failed' && turn.parentTurnId !== null) {
    // A failed turn is always its branch's head: nothing can follow it (TRN-058).
    const branch = listBranches(db).find((each) => each.headTurnId === turn.id);
    if (branch !== undefined) {
      abandonTurn(db, branch.id, turn.id);
      deps.publish(campaignId, { type: 'turn.status', turnId: turn.id, status: 'abandoned' });
      deps.logger.info({ campaignId, turnId: turn.id }, 'turn abandoned');
    }
  }
  return turnView(deps, campaignId, turn.id);
}
