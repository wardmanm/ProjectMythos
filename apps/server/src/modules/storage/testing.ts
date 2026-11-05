// Helpers for storage's own tests: fresh folders in os.tmpdir() (CONV-116), and
// builders for campaigns, turns, and sets. Not exported from index.ts.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Branch, CommitPayload, CommitSet, Turn } from '@mythos/contracts';
import { z } from 'zod';
import { type CampaignStore, type CampaignStoreOptions, createCampaignStore } from './campaigns';
import type { CampaignRecord } from './rows';
import type { Database } from './sqlite';
import type { NewCommitSet } from './turns';

/** A fixed wall-clock time for records made in tests. */
export const TEST_NOW = new Date('2026-11-05T12:00:00.000Z');

/**
 * Tracks what a test file makes, so `cleanUp` (run in `afterEach`) closes every
 * database before removing its folder: Windows cannot delete an open file.
 */
export function createTestSpace() {
  const folders: string[] = [];
  const stores: CampaignStore[] = [];
  const databases: Database[] = [];

  return {
    /** A new, empty folder in os.tmpdir(). Implements CONV-116. */
    folder(): string {
      const dir = mkdtempSync(path.join(tmpdir(), 'mythos-storage-'));
      folders.push(dir);
      return dir;
    },
    /** A campaign store on a new data directory, closed at clean-up. */
    store(options: Partial<CampaignStoreOptions> = {}): CampaignStore {
      const store = createCampaignStore({
        dataDir: options.dataDir ?? this.folder(),
        now: options.now ?? (() => TEST_NOW),
        modelCallRecordDays: options.modelCallRecordDays ?? (() => null),
        ...(options.migrationsDir === undefined ? {} : { migrationsDir: options.migrationsDir }),
      });
      stores.push(store);
      return store;
    },
    /** Registers a database opened directly, to be closed at clean-up. */
    track(db: Database): Database {
      databases.push(db);
      return db;
    },
    cleanUp(): void {
      for (const store of stores.splice(0)) store.closeAll();
      for (const db of databases.splice(0)) if (db.isOpen) db.close();
      for (const dir of folders.splice(0)) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  };
}

const CountSchema = z.object({ count: z.int().nonnegative() });

/** How many rows `table` holds. */
export function countRows(db: Database, table: string): number {
  return CountSchema.parse(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count;
}

/** A campaign record for a campaign made from the reference pack's *Arrival*. */
export function testCampaign(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: randomUUID(),
    name: 'Brinemoor test',
    packId: 'reference',
    packVersion: '1.0.0',
    settingId: 'setting.brinemoor',
    scenarioId: 'scenario.arrival',
    toneProfileId: 'tone.coastal-mystery',
    rulesetId: 'ruleset.standard',
    themeId: 'theme.house',
    pcId: 'pc.wren',
    firstSceneId: randomUUID(),
    createdAt: TEST_NOW.toISOString(),
    lastPlayedAt: TEST_NOW.toISOString(),
    ...overrides,
  };
}

/** A new store with one new campaign in it. */
export async function newTestCampaign(space: ReturnType<typeof createTestSpace>) {
  const store = space.store();
  const campaign = testCampaign();
  const db = await store.createCampaignFolder(campaign);
  return { store, campaign, db };
}

/** A turn record; pass `parent` for a child turn, or nothing for a root. */
export function testTurn(parent: Turn | null = null): Turn {
  return {
    id: randomUUID(),
    parentTurnId: parent?.id ?? null,
    depth: parent === null ? 0 : parent.depth + 1,
    status: 'complete',
    gameTimeStart: 0,
    copiedFromTurnId: null,
    createdAt: TEST_NOW.toISOString(),
  };
}

/** A branch record pointing at `head`. */
export function testBranch(head: Turn, name = 'Main'): Branch {
  return {
    id: randomUUID(),
    name,
    headTurnId: head.id,
    forkedFromTurnId: null,
    archived: false,
    createdAt: TEST_NOW.toISOString(),
  };
}

/** An `input.set` payload. */
export function inputPayload(text: string): CommitPayload {
  return { type: 'input.set', mode: 'ic', text };
}

/** A set on `turn` holding `payloads`, optionally superseding another set. */
export function testSet(
  turn: Turn,
  stage: CommitSet['stage'],
  payloads: readonly CommitPayload[],
  supersedes: { id: string } | null = null,
): NewCommitSet {
  return {
    set: {
      id: randomUUID(),
      turnId: turn.id,
      stage,
      origin: stage === 'setup' ? 'engine' : 'player',
      supersedesSetId: supersedes?.id ?? null,
      basedOnSetIds: [],
      copiedFromSetId: null,
      schemaVersion: 1,
      createdAt: TEST_NOW.toISOString(),
    },
    commits: payloads.map((payload) => ({ id: randomUUID(), payload })),
  };
}
