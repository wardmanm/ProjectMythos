// Helpers for this module's tests only: data directories in os.tmpdir() (CONV-116), the
// reference pack copied into one, seeded IDs, a fixed time source, and a logger that keeps
// what it is given. Not exported from index.ts.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CommitPayload, CreateCampaignCommand } from '@mythos/contracts';
import { type ContentSources, createContent, defaultSources } from '../content';
import {
  type CampaignStore,
  createCampaignStore,
  type Database,
  readSetsForRead,
} from '../storage';
import type { CreateCampaignDeps } from './create-campaign';
import type { NarrationStart, TurnLogger } from './deps';

/** The wall time every test record gets. */
export const TEST_NOW = new Date('2026-11-05T12:00:00.000Z');

/** UUIDs counting up from 1, so a test's IDs are the same on every run. */
export function seededIds(): () => string {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`;
}

export type LogEntry = {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string;
};

export function recordingLogger(): TurnLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const at = (level: LogEntry['level']) => (fields: Record<string, unknown>, message: string) => {
    entries.push({ level, fields, message });
  };
  return { entries, info: at('info'), warn: at('warn'), error: at('error') };
}

/** The command that creates a campaign from *Arrival* with the pack's defaults. */
export function arrivalCommand(
  overrides: Partial<CreateCampaignCommand> = {},
): CreateCampaignCommand {
  return {
    name: 'Brinemoor',
    packId: 'reference',
    scenarioId: 'scenario.arrival',
    toneProfileId: 'tone.coastal-mystery',
    rulesetId: 'ruleset.standard',
    conversion: null,
    pc: { mode: 'premade' },
    ...overrides,
  };
}

/** The payloads of the root turn's setup set, in commit order. */
export function setupPayloads(db: Database, branchId: string, turnId: string): CommitPayload[] {
  const sets = readSetsForRead(db, { branchId, turnId, beforeStage: 'end' });
  return sets.flatMap(({ set, commits }) =>
    set.stage === 'setup' ? commits.map(({ payload }) => payload) : [],
  );
}

/**
 * Tracks the folders and stores a test file makes, so `cleanUp` (run in `afterEach`)
 * closes every database before removing its folder: Windows cannot delete an open file.
 */
export function createTestSpace() {
  const folders: string[] = [];
  const stores: CampaignStore[] = [];
  const repository = defaultSources(tmpdir());

  return {
    /** A new, empty folder in os.tmpdir(). Implements CONV-116. */
    folder(): string {
      const dir = mkdtempSync(path.join(tmpdir(), 'mythos-turn-'));
      folders.push(dir);
      return dir;
    },

    /**
     * Copies the reference pack to `<dataDir>/content-packs/reference/` and returns that
     * folder. With `onlyDataDir` sources, the copy is the only pack there is.
     */
    copyReferencePack(dataDir: string): string {
      const packDir = path.join(dataDir, 'content-packs', 'reference');
      const [repositoryPacks] = repository.packFolders;
      if (repositoryPacks === undefined) throw new Error('defaultSources lists no pack folder');
      cpSync(path.join(repositoryPacks, 'reference'), packDir, { recursive: true });
      return packDir;
    },

    /** The repository's libraries, but packs only from `<dataDir>/content-packs/`. */
    onlyDataDir(dataDir: string): ContentSources {
      return { ...defaultSources(dataDir), packFolders: [path.join(dataDir, 'content-packs')] };
    },

    /**
     * Everything createCampaign needs, on a new data directory unless `sources` says.
     * Its `narrations` only records what it is asked to start, in `started`, so a test
     * that stores turns itself is never raced by an opening narration.
     */
    deps(options: { dataDir?: string; sources?: ContentSources } = {}) {
      const dataDir = options.dataDir ?? this.folder();
      const timeSource = { now: () => TEST_NOW.getTime() };
      const store = createCampaignStore({ dataDir, timeSource, modelCallRecordDays: () => null });
      stores.push(store);
      const logger = recordingLogger();
      const sources = options.sources ?? defaultSources(dataDir);
      const content = createContent({ sources, logger });
      const started: NarrationStart[] = [];
      const narrations = {
        start: (narration: NarrationStart) => {
          started.push(narration);
        },
      };
      const newId = seededIds();
      const deps: CreateCampaignDeps = { store, content, timeSource, newId, logger, narrations };
      return { ...deps, dataDir, logger, started };
    },

    cleanUp(): void {
      for (const store of stores.splice(0)) store.closeAll();
      for (const dir of folders.splice(0)) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  };
}
