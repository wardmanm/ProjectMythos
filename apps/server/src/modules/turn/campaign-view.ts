// What the library and the play screen show of a campaign (03-contracts §14.1), built from
// its own database only: the campaign row, its canon, its campaign state, and the head of
// its current branch, folded. The pack is never read again (ARCH-045).
import {
  type AppError,
  type CampaignSummary,
  type CampaignView,
  err,
  ok,
  type Result,
} from '@mythos/contracts';
import {
  cmp,
  type CommitSetEntry,
  type FoldContext,
  fold,
  formatDate,
  initialState,
  orderSets,
  toDate,
} from '@mythos/core';
import {
  type CampaignRecord,
  type CampaignStore,
  type Database,
  readBranch,
  readCanon,
  readSetsForRead,
  readState,
} from '../storage';

// A campaign database missing what creation always writes is corrupt (CONV-041).
function stored<T>(db: Database, value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${db.path} has no ${what}`);
  return value;
}

/** The game time at the head of `branchId`: its active sets in TRN-061's order, folded. */
function headGameTime(
  db: Database,
  record: CampaignRecord,
  scenePlaceId: string,
  branchId: string,
  context: FoldContext,
): { headTurnId: string; gameTime: number } {
  const branch = stored(db, readBranch(db, branchId), `branch ${branchId}`);
  const point = { branchId, turnId: branch.headTurnId, beforeStage: 'end' as const };
  const sets = readSetsForRead(db, point);
  const depthByTurnId = Object.fromEntries(sets.map(({ set, depth }) => [set.turnId, depth]));
  const commitsBySetId = new Map(sets.map(({ set, commits }) => [set.id, commits]));
  // orderSets is the only definition of the order (06-turn-engine Decisions).
  const entries = orderSets(
    sets.map(({ set }) => set),
    depthByTurnId,
  ).map((set): CommitSetEntry => ({ set, commits: commitsBySetId.get(set.id) ?? [] }));
  const start = initialState({ pcId: record.pcId, scenePlaceId, sceneId: record.firstSceneId });
  const { state } = fold(start, entries, context);
  return { headTurnId: branch.headTurnId, gameTime: state.world.gameTime };
}

/**
 * The campaign in `db` as the play screen opens it, with the game time at its current
 * branch's head in its own calendar. Implements ARCH-045.
 */
export function campaignViewOf(store: CampaignStore, db: Database): CampaignView {
  const record = store.readCampaign(db);
  const setting = stored(db, readCanon(db, 'setting', record.settingId), record.settingId).value;
  const canonValue = <K extends 'calendar' | 'slots' | 'tone' | 'ruleset' | 'scenario' | 'theme'>(
    kind: K,
    id: string,
  ) => stored(db, readCanon(db, kind, id), `${kind} ${id}`).value;
  const calendar = canonValue('calendar', setting.calendarId);
  const tone = canonValue('tone', record.toneProfileId);
  const context: FoldContext = {
    ruleset: canonValue('ruleset', record.rulesetId),
    slots: canonValue('slots', tone.slotSchemaId ?? setting.slotSchemaId),
  };
  const scenario = canonValue('scenario', record.scenarioId);
  const branchId = stored(db, readState(db, 'current_branch_id'), 'current branch');
  const head = headGameTime(db, record, scenario.startPlaceId, branchId, context);
  const date = toDate(calendar, setting.epoch, setting.epochWeekday, head.gameTime);
  return {
    campaignId: record.id,
    name: record.name,
    settingName: setting.name,
    gameTimeLabel: formatDate(calendar, date),
    lastPlayedAt: record.lastPlayedAt,
    themeId: record.themeId,
    contentSettings: stored(db, readState(db, 'content_settings'), 'content settings'),
    packId: record.packId,
    rulesetId: record.rulesetId,
    pcId: record.pcId,
    currentBranchId: branchId,
    headTurnId: head.headTurnId,
    theme: canonValue('theme', record.themeId),
  };
}

/** One campaign's view, or `not_found`. Implements ARCH-045. */
export function campaignView(
  store: CampaignStore,
  campaignId: string,
): Result<CampaignView, AppError> {
  const opened = store.openCampaign(campaignId);
  if (!opened.ok) return err(opened.error);
  return ok(campaignViewOf(store, opened.value));
}

/** Every campaign's summary, most recently played first (03-contracts §14.2). */
export async function listCampaignSummaries(store: CampaignStore): Promise<CampaignSummary[]> {
  const summaries: CampaignSummary[] = [];
  for (const campaignId of await store.listCampaigns()) {
    const opened = store.openCampaign(campaignId);
    // listCampaigns found its database a moment ago, so failing to open it is a defect.
    if (!opened.ok) throw new Error(`campaign ${campaignId} is listed but would not open`);
    const view = campaignViewOf(store, opened.value);
    summaries.push({
      campaignId: view.campaignId,
      name: view.name,
      settingName: view.settingName,
      gameTimeLabel: view.gameTimeLabel,
      lastPlayedAt: view.lastPlayedAt,
      themeId: view.themeId,
      contentSettings: view.contentSettings,
    });
  }
  // WallTime strings with different fraction digits sort wrongly as text (02-conventions
  // Traps), so compare their times.
  const playedAt = (summary: CampaignSummary) => Date.parse(summary.lastPlayedAt);
  return summaries.sort((a, b) => playedAt(b) - playedAt(a) || cmp(a.campaignId, b.campaignId));
}
