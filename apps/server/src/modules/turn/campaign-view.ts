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
import { cmp, formatDate, toDate } from '@mythos/core';
import { type CampaignStore, type Database, readBranch, readCanon, readState } from '../storage';
import { foldAtPoint, pointBefore, stored } from './read-point';

/** The head of `branchId` and the game time there, its sets folded (TRN-060). */
function headGameTime(
  store: CampaignStore,
  db: Database,
  branchId: string,
): { headTurnId: string; gameTime: number } {
  const branch = stored(db, readBranch(db, branchId), `branch ${branchId}`);
  const point = pointBefore(branchId, branch.headTurnId, 'end');
  const { state } = foldAtPoint(store, db, point);
  return { headTurnId: branch.headTurnId, gameTime: state.world.gameTime };
}

/**
 * Formats game times as the player reads them, in the campaign's own calendar
 * (TIME-010). The calendar is read once, so a page of turns reads it once.
 */
export function gameTimeLabeller(store: CampaignStore, db: Database): (gameTime: number) => string {
  const record = store.readCampaign(db);
  const setting = stored(db, readCanon(db, 'setting', record.settingId), record.settingId).value;
  const calendarId = setting.calendarId;
  const calendar = stored(db, readCanon(db, 'calendar', calendarId), `calendar ${calendarId}`);
  return (gameTime) =>
    formatDate(
      calendar.value,
      toDate(calendar.value, setting.epoch, setting.epochWeekday, gameTime),
    );
}

/**
 * The campaign in `db` as the play screen opens it, with the game time at its current
 * branch's head in its own calendar. Implements ARCH-045.
 */
export function campaignViewOf(store: CampaignStore, db: Database): CampaignView {
  const record = store.readCampaign(db);
  const setting = stored(db, readCanon(db, 'setting', record.settingId), record.settingId).value;
  const theme = stored(db, readCanon(db, 'theme', record.themeId), `theme ${record.themeId}`);
  const branchId = stored(db, readState(db, 'current_branch_id'), 'current branch');
  const head = headGameTime(store, db, branchId);
  return {
    campaignId: record.id,
    name: record.name,
    settingName: setting.name,
    gameTimeLabel: gameTimeLabeller(store, db)(head.gameTime),
    lastPlayedAt: record.lastPlayedAt,
    themeId: record.themeId,
    contentSettings: stored(db, readState(db, 'content_settings'), 'content settings'),
    packId: record.packId,
    rulesetId: record.rulesetId,
    pcId: record.pcId,
    currentBranchId: branchId,
    headTurnId: head.headTurnId,
    theme: theme.value,
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
