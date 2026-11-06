// Campaign creation (03-contracts §14, 04-content-schemas §11): check the command, build
// and validate the setup set, then write the campaign folder, its canon, its first
// campaign state, and its root turn on branch Main. Every expected failure is found before
// anything is written (CON-112, TRN-070).
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  type AppError,
  type CampaignView,
  type CreateCampaignCommand,
  err,
  ok,
  type Result,
  type TimeSource,
} from '@mythos/contracts';
import {
  buildSetup,
  type CommitSetEntry,
  initialState,
  type Setup,
  validateSet,
} from '@mythos/core';
import type { Content, LoadedPack } from '../content';
import {
  type CampaignRecord,
  type CampaignStart,
  type CampaignStore,
  type NewCommitSet,
  writeCampaignStart,
} from '../storage';
import { campaignViewOf } from './campaign-view';
import { type CheckedCommand, checkCommand } from './check-command';
import { canonEntries, templateFiles } from './snapshot';

/** The logger methods the module uses; the server's pino logger fits it (CONV-071). */
export type TurnLogger = {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

export type CreateCampaignDeps = {
  store: CampaignStore;
  content: Pick<Content, 'loadPack'>;
  /** Wall time, for the records' times (CONV-061). */
  timeSource: TimeSource;
  /** A new UUID on each call; tests pass a seeded one. */
  newId: () => string;
  logger: TurnLogger;
};

/** The IDs the campaign record, root turn, setup set, and branch Main take. */
type NewIds = { campaignId: string; turnId: string; setId: string; branchId: string };

/** A pack that is missing or has problems, as a problem with the command's `packId`. */
function packRefused(error: AppError): AppError {
  return {
    code: 'validation_failed',
    message: error.message,
    details: { issues: [{ path: 'packId', message: error.message }] },
  };
}

/** The setup set, checked against the initial state with the fold's strict validation. */
function validatedSetupSet(
  checked: CheckedCommand,
  setup: Setup,
  ids: NewIds,
  newId: () => string,
  createdAt: string,
): Result<NewCommitSet, AppError> {
  const setupSet: NewCommitSet = {
    set: {
      id: ids.setId,
      turnId: ids.turnId,
      stage: 'setup',
      origin: 'engine',
      supersedesSetId: null,
      basedOnSetIds: [],
      copiedFromSetId: null,
      schemaVersion: 1,
      createdAt,
    },
    commits: setup.payloads.map((payload) => ({ id: newId(), payload })),
  };
  // The first set in a new campaign gets seq 0 from storage (CON-084).
  const entry: CommitSetEntry = {
    set: { ...setupSet.set, seq: 0 },
    commits: setupSet.commits.map((commit, seq) => ({ ...commit, setId: ids.setId, seq })),
  };
  const start = initialState({
    pcId: checked.pcId,
    scenePlaceId: checked.scenario.startPlaceId,
    sceneId: setup.sceneId,
  });
  // Implements TRN-070: nothing is written unless the whole set validates.
  const valid = validateSet(start, entry, {
    ruleset: checked.ruleset.definition,
    slots: checked.slots,
  });
  return valid.ok ? ok(setupSet) : err(valid.error);
}

function campaignRecord(
  command: CreateCampaignCommand,
  pack: LoadedPack,
  checked: CheckedCommand,
  ids: NewIds,
  firstSceneId: string,
  createdAt: string,
): CampaignRecord {
  return {
    id: ids.campaignId,
    name: command.name,
    packId: pack.manifest.id,
    packVersion: pack.manifest.version,
    settingId: pack.setting.id,
    scenarioId: checked.scenario.id,
    toneProfileId: checked.toneProfile.definition.id,
    rulesetId: checked.ruleset.definition.id,
    themeId: checked.theme.id,
    pcId: checked.pcId,
    firstSceneId,
    createdAt,
    lastPlayedAt: createdAt,
  };
}

/**
 * The root turn, at the scenario's start and waiting for its opening narration, and branch
 * Main at it (06-turn-engine Decisions).
 */
function rootTurnOnMain(
  ids: NewIds,
  startGameTime: number,
  createdAt: string,
): Pick<CampaignStart, 'turn' | 'branch'> {
  return {
    turn: {
      id: ids.turnId,
      parentTurnId: null,
      depth: 0,
      status: 'narrating',
      gameTimeStart: startGameTime,
      copiedFromTurnId: null,
      createdAt,
    },
    branch: {
      id: ids.branchId,
      name: 'Main',
      headTurnId: ids.turnId,
      forkedFromTurnId: null,
      archived: false,
      createdAt,
    },
  };
}

/**
 * Makes the folder and `campaign` row, then writes the rest in one transaction. If either
 * throws, the folder is removed and the error rethrown, so no half-made campaign is left.
 */
async function writeCampaign(
  deps: CreateCampaignDeps,
  record: CampaignRecord,
  start: CampaignStart,
): Promise<void> {
  // A folder with this ID is another campaign's, so it must not be removed on failure.
  if (existsSync(path.join(deps.store.campaignsDir, record.id))) {
    throw new Error(`campaign ${record.id} already exists`);
  }
  try {
    const db = await deps.store.createCampaignFolder(record);
    writeCampaignStart(db, start);
  } catch (error) {
    deps.logger.error({ campaignId: record.id, err: error }, 'campaign creation failed');
    await deps.store.deleteCampaign(record.id);
    throw error;
  }
}

/**
 * Creates a campaign from a pack's scenario with its premade PC, or returns
 * `validation_failed` with every issue in the command (CON-112), or
 * `illegal_state_change` when the setup set does not validate (TRN-070). The root turn is
 * left `narrating`, for its opening narration. Setup's warnings are logged. Implements
 * SCH-110, SCH-111, SCH-112, CON-112, CSET-020, and CTX-005.
 */
export async function createCampaign(
  deps: CreateCampaignDeps,
  command: CreateCampaignCommand,
): Promise<Result<CampaignView, AppError>> {
  const loaded = await deps.content.loadPack(command.packId);
  if (!loaded.ok) return err(packRefused(loaded.error));
  const pack = loaded.value;
  const checked = checkCommand(pack, command);
  if (!checked.ok) return err(checked.error);
  const chosen = checked.value;

  const { newId } = deps;
  const ids: NewIds = { campaignId: newId(), turnId: newId(), setId: newId(), branchId: newId() };
  const createdAt = new Date(deps.timeSource.now()).toISOString();
  const setup = buildSetup(
    pack,
    {
      scenario: chosen.scenario,
      pcId: chosen.pcId,
      ruleset: chosen.ruleset.definition,
      turnId: ids.turnId,
    },
    newId,
  );
  const setupSet = validatedSetupSet(chosen, setup, ids, newId, createdAt);
  if (!setupSet.ok) return err(setupSet.error);

  // Read before the folder exists, so a template that cannot be read leaves nothing behind.
  const templates = await templateFiles(pack, chosen);
  const record = campaignRecord(command, pack, chosen, ids, setup.sceneId, createdAt);
  await writeCampaign(deps, record, {
    canon: { entries: canonEntries(pack, chosen), templates },
    contentSettings: chosen.contentSettings,
    ...rootTurnOnMain(ids, setup.startGameTime, createdAt),
    sets: [setupSet.value],
    createdAt,
  });
  for (const warning of setup.warnings) {
    deps.logger.warn({ campaignId: record.id, warning }, 'campaign setup changed the pack');
  }
  deps.logger.info({ campaignId: record.id, packId: record.packId }, 'campaign created');
  const db = deps.store.openCampaign(record.id);
  if (!db.ok) throw new Error(`campaign ${record.id} was created but would not open`);
  return ok(campaignViewOf(deps.store, db.value));
}
