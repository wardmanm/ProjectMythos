// Campaign folders and their connections. A campaign is one folder holding
// campaign.sqlite and assets/ (ARCH-031); this store creates, opens, lists, and
// deletes them, and keeps one open connection per campaign. The composition root
// builds one store (ARCH-022), so no connection lives in module state.
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { type AppError, err, IdSchema, ok, type Result, type TimeSource } from '@mythos/contracts';
import { cmp } from '@mythos/core';
import { migrate } from './migrate';
import { pruneModelCalls } from './model-calls';
import { type CampaignRecord, CampaignRowSchema, parseRow } from './rows';
import { type Database, openDatabase } from './sqlite';

export const CAMPAIGNS_FOLDER = 'campaigns';
export const CAMPAIGN_DATABASE_FILE = 'campaign.sqlite';
export const ASSETS_FOLDER = 'assets';

const DAY_MS = 24 * 60 * 60 * 1000;

export type CampaignStoreOptions = {
  /** The data directory; campaigns live in its `campaigns/` folder (ARCH-030). */
  dataDir: string;
  /** Wall time, injected so tests can fix it (CONV-061). */
  timeSource: TimeSource;
  /** Machine config's `retention.modelCallRecordDays`, read at each open; null keeps all. */
  modelCallRecordDays: () => number | null;
  /** The migrations folder; tests pass their own. */
  migrationsDir?: string;
};

export type CampaignStore = {
  /** `<dataDir>/campaigns`. */
  readonly campaignsDir: string;
  /**
   * Creates the campaign's folder, its `assets/` folder, and its database, and writes
   * its `campaign` row. Returns the open connection.
   */
  createCampaignFolder(campaign: CampaignRecord): Promise<Database>;
  /** The campaign's connection, opened, migrated, and pruned on first use; `not_found` if none. */
  openCampaign(campaignId: string): Result<Database, AppError>;
  /** The IDs of every campaign folder that holds a database, sorted. */
  listCampaigns(): Promise<string[]>;
  /** Closes the campaign's connection and removes its folder. */
  deleteCampaign(campaignId: string): Promise<Result<void, AppError>>;
  /** Closes the campaign's connection if it is open. */
  closeCampaign(campaignId: string): void;
  /** Closes every open connection, at shutdown. */
  closeAll(): void;
  /** The campaign's `campaign` row. */
  readCampaign(db: Database): CampaignRecord;
  /** Sets the campaign's last-played time to now. */
  touchLastPlayed(db: Database): void;
};

function notFound(campaignId: string): AppError {
  return { code: 'not_found', message: `No campaign ${campaignId}.` };
}

function insertCampaignRow(db: Database, campaign: CampaignRecord): void {
  db.prepare(
    `INSERT INTO campaign (only_row, id, name, pack_id, pack_version, setting_id, scenario_id,
       tone_profile_id, ruleset_id, theme_id, pc_id, first_scene_id, created_at, last_played_at)
     VALUES (1, :id, :name, :packId, :packVersion, :settingId, :scenarioId, :toneProfileId,
       :rulesetId, :themeId, :pcId, :firstSceneId, :createdAt, :lastPlayedAt)`,
  ).run({
    id: campaign.id,
    name: campaign.name,
    packId: campaign.packId,
    packVersion: campaign.packVersion,
    settingId: campaign.settingId,
    scenarioId: campaign.scenarioId,
    toneProfileId: campaign.toneProfileId,
    rulesetId: campaign.rulesetId,
    themeId: campaign.themeId,
    pcId: campaign.pcId,
    firstSceneId: campaign.firstSceneId,
    createdAt: campaign.createdAt,
    lastPlayedAt: campaign.lastPlayedAt,
  });
}

/** Builds the store. Called once, by the composition root (ARCH-022). */
export function createCampaignStore(options: CampaignStoreOptions): CampaignStore {
  const campaignsDir = path.join(options.dataDir, CAMPAIGNS_FOLDER);
  const open = new Map<string, Database>();

  // A campaign ID is a UUID, which also keeps it from naming a path outside campaigns/.
  const folderOf = (campaignId: string) => path.join(campaignsDir, campaignId);
  const databaseOf = (campaignId: string) =>
    path.join(folderOf(campaignId), CAMPAIGN_DATABASE_FILE);

  function connect(campaignId: string): Database {
    const db = openDatabase(databaseOf(campaignId));
    try {
      migrate(db, options.migrationsDir);
      // Implements ARCH-061: old model call records go when the campaign opens.
      const days = options.modelCallRecordDays();
      if (days !== null) {
        const cutoff = new Date(options.timeSource.now() - days * DAY_MS);
        pruneModelCalls(db, cutoff.toISOString());
      }
    } catch (error) {
      db.close();
      throw error;
    }
    open.set(campaignId, db);
    return db;
  }

  function closeCampaign(campaignId: string): void {
    open.get(campaignId)?.close();
    open.delete(campaignId);
  }

  return {
    campaignsDir,

    async createCampaignFolder(campaign) {
      const folder = folderOf(IdSchema.parse(campaign.id));
      await mkdir(campaignsDir, { recursive: true });
      await mkdir(folder); // throws if it exists: campaign IDs are never reused
      await mkdir(path.join(folder, ASSETS_FOLDER)); // ARCH-130, MED-011
      const db = connect(campaign.id);
      insertCampaignRow(db, campaign);
      return db;
    },

    openCampaign(campaignId) {
      if (!IdSchema.safeParse(campaignId).success) return err(notFound(campaignId));
      const cached = open.get(campaignId);
      if (cached !== undefined) return ok(cached);
      // Opening a missing file would create an empty database, so check first.
      if (!existsSync(databaseOf(campaignId))) return err(notFound(campaignId));
      return ok(connect(campaignId));
    },

    async listCampaigns() {
      if (!existsSync(campaignsDir)) return [];
      const entries = await readdir(campaignsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && IdSchema.safeParse(entry.name).success)
        .map((entry) => entry.name)
        .filter((campaignId) => existsSync(databaseOf(campaignId)))
        .sort(cmp);
    },

    async deleteCampaign(campaignId) {
      if (!IdSchema.safeParse(campaignId).success || !existsSync(folderOf(campaignId))) {
        return err(notFound(campaignId));
      }
      // Windows will not delete an open file, so close the connection first; the
      // retries cover a virus scanner or indexer holding a file for a moment.
      closeCampaign(campaignId);
      await rm(folderOf(campaignId), { recursive: true, force: true, maxRetries: 5 });
      return ok(undefined);
    },

    closeCampaign,

    closeAll() {
      for (const campaignId of [...open.keys()]) closeCampaign(campaignId);
    },

    readCampaign(db) {
      const row = db.prepare('SELECT * FROM campaign WHERE only_row = 1').get();
      if (row === undefined) throw new Error(`${db.path} has no campaign row`);
      return parseRow('campaign', CampaignRowSchema, row, ['id']);
    },

    touchLastPlayed(db) {
      db.prepare('UPDATE campaign SET last_played_at = :now WHERE only_row = 1').run({
        now: new Date(options.timeSource.now()).toISOString(),
      });
    },
  };
}
