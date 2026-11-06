// Retrying a failed narration (TRN-052), the one regeneration phase 1 has (06-turn-engine
// §11), and leaving the turns a restart interrupted ready for it (TRN-012).
import { type AppError, err, ok, type Result, type Turn } from '@mythos/contracts';
import { type Database, readTurnSets, readTurnsWithStatus, setTurnStatus } from '../storage';
import type { RegenerateStageCommand, TurnDeps } from './deps';
import { expectedHead, refused } from './submit-action';

/** The phase that brings each stage's regeneration. */
const STAGE_PHASES = { adjudication: 3, resolution: 3, extraction: 4 } as const;

/** What phase 1 cannot regenerate yet, as `validation_failed` at the field that asks for it. */
function notInPhaseOne(command: RegenerateStageCommand): AppError | null {
  if (command.stage !== 'narration') {
    const phase = String(STAGE_PHASES[command.stage]);
    return refused('stage', `Regenerating ${command.stage} arrives in phase ${phase}.`);
  }
  if (command.instruction !== undefined) {
    return refused('instruction', 'Regenerating with an instruction arrives in phase 2.');
  }
  if (command.profileId !== undefined) {
    return refused('profileId', 'Regenerating with another model arrives in phase 2.');
  }
  return null;
}

/** The set a turn's narration is based on: its input, or the root turn's setup set. */
function basedOnSetIdOf(db: Database, turn: Turn): string {
  const stage = turn.parentTurnId === null ? 'setup' : 'input';
  const found = readTurnSets(db, turn.id).find(({ set }) => set.stage === stage);
  if (found === undefined) throw new Error(`${db.path}: turn ${turn.id} has no ${stage} set`);
  return found.set.id;
}

/**
 * Runs a failed narration again: the head turn must be `stage-failed` (TRN-052). Returns
 * the turn's ID as soon as the narration starts; its progress arrives as events
 * (06-turn-engine §10). Implements TRN-120 and TRN-058 for the retry.
 */
export function regenerateStage(
  deps: TurnDeps,
  campaignId: string,
  command: RegenerateStageCommand,
): Result<{ turnId: string }, AppError> {
  const later = notInPhaseOne(command);
  if (later !== null) return err(later);
  const opened = deps.store.openCampaign(campaignId);
  if (!opened.ok) return opened;
  const db = opened.value;
  const checked = expectedHead(db, command.branchId, command.expectedHeadTurnId);
  if (!checked.ok) return checked;
  const { head } = checked.value;
  if (command.turnId !== head.id) {
    return err(refused('turnId', 'Regenerating an earlier turn arrives in phase 2.'));
  }
  if (head.status === 'narrating' || deps.narrations.inFlight(campaignId)) {
    return err({ code: 'turn_in_progress', message: 'The GM is still narrating the last turn.' });
  }
  if (head.status !== 'stage-failed') {
    return err(refused('stage', 'Regenerating narration that finished arrives in phase 2.'));
  }
  const basedOnSetId = basedOnSetIdOf(db, head);
  setTurnStatus(db, head.id, 'narrating');
  deps.publish(campaignId, { type: 'turn.status', turnId: head.id, status: 'narrating' });
  deps.narrations.start({ campaignId, branchId: command.branchId, turnId: head.id, basedOnSetId });
  return ok({ turnId: head.id });
}

/**
 * At server start, before any request: every turn left `adjudicating` or `narrating`
 * becomes `stage-failed`, since interactive jobs are not persisted (PRV-061), and the
 * player retries it. A campaign that fails to open is logged and skipped. Returns how
 * many turns changed. Implements TRN-012.
 */
export async function recoverInterruptedTurns(
  deps: Pick<TurnDeps, 'store' | 'logger'>,
): Promise<number> {
  let recovered = 0;
  for (const campaignId of await deps.store.listCampaigns()) {
    try {
      const opened = deps.store.openCampaign(campaignId);
      if (!opened.ok) throw new Error(opened.error.message);
      const db = opened.value;
      for (const turn of readTurnsWithStatus(db, ['adjudicating', 'narrating'])) {
        setTurnStatus(db, turn.id, 'stage-failed');
        recovered += 1;
        deps.logger.info({ campaignId, turnId: turn.id }, 'interrupted turn left stage-failed');
      }
    } catch (error) {
      deps.logger.error({ campaignId, err: error }, 'could not recover interrupted turns');
    }
  }
  return recovered;
}
