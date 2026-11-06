// Where a stage reads (TRN-060), and the folded state there, from the campaign's own
// database (ARCH-045). Every read of folded state in this module goes through here.
import { type AppError, err, ok, type ReadPoint, type Result } from '@mythos/contracts';
import {
  type CommitSetEntry,
  entriesInOrder,
  type FoldContext,
  type FoldedState,
  fold,
  initialState,
  validateSet,
} from '@mythos/core';
import {
  type CampaignStore,
  type Database,
  type NewCommitSet,
  readCanon,
  readSetsForRead,
} from '../storage';

// A campaign database missing what creation always writes is corrupt (CONV-041).
export function stored<T>(db: Database, value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${db.path} has no ${what}`);
  return value;
}

/**
 * The read point for `stage` of `turnId` (TRN-060): the turn's ancestry, and its own
 * active sets of the stages before `stage`. `'end'` reads the whole turn. A world-tick
 * point also needs `worldTicksBefore`, so it is not built here (TIME-053).
 */
export function pointBefore(
  branchId: string,
  turnId: string,
  stage: Exclude<ReadPoint['beforeStage'], 'world-tick'>,
): ReadPoint {
  return { branchId, turnId, beforeStage: stage };
}

/** The ruleset and slot schema the fold checks commits against, from the snapshot. */
export function foldContextOf(store: CampaignStore, db: Database): FoldContext {
  const record = store.readCampaign(db);
  const setting = stored(db, readCanon(db, 'setting', record.settingId), record.settingId).value;
  const tone = stored(db, readCanon(db, 'tone', record.toneProfileId), 'tone profile').value;
  const slotSchemaId = tone.slotSchemaId ?? setting.slotSchemaId;
  return {
    ruleset: stored(db, readCanon(db, 'ruleset', record.rulesetId), 'ruleset').value,
    slots: stored(db, readCanon(db, 'slots', slotSchemaId), `slots ${slotSchemaId}`).value,
  };
}

/**
 * The folded state at `point`: its active sets in TRN-061's order (core's
 * `entriesInOrder`), folded from the campaign's initial state, with the context they
 * were folded with, so a new set can be validated against the same state (TRN-070).
 */
export function foldAtPoint(
  store: CampaignStore,
  db: Database,
  point: ReadPoint,
): { state: FoldedState; context: FoldContext } {
  const record = store.readCampaign(db);
  const scenario = stored(db, readCanon(db, 'scenario', record.scenarioId), 'scenario').value;
  const context = foldContextOf(store, db);
  const start = initialState({
    pcId: record.pcId,
    scenePlaceId: scenario.startPlaceId,
    sceneId: record.firstSceneId,
  });
  const { state } = fold(start, entriesInOrder(readSetsForRead(db, point)), context);
  return { state, context };
}

/**
 * Checks a set about to be written against the state at its point, with the fold's
 * strict validation: `illegal_state_change` listing every issue, or ok (TRN-070).
 */
export function checkSet(
  state: FoldedState,
  context: FoldContext,
  newSet: NewCommitSet,
): Result<void, AppError> {
  // Storage assigns the set's seq when it writes it (CON-084); validation never reads it.
  const entry: CommitSetEntry = {
    set: { ...newSet.set, seq: 0 },
    commits: newSet.commits.map((commit, seq) => ({ ...commit, setId: newSet.set.id, seq })),
  };
  const valid = validateSet(state, entry, context);
  return valid.ok ? ok(undefined) : err(valid.error);
}
