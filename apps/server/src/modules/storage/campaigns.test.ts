import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ModelCallRecord } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ASSETS_FOLDER, CAMPAIGN_DATABASE_FILE } from './campaigns';
import { insertModelCall, readModelCall } from './model-calls';
import {
  countRows,
  createTestSpace,
  inputPayload,
  newTestCampaign,
  TEST_NOW,
  testBranch,
  testCampaign,
  testSet,
  testTurn,
} from './testing';
import { insertRootTurn, insertTurn, readTurnsOnBranch } from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

function opened<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe('campaign folders', () => {
  it('ARCH-130: a new campaign has an assets folder and empty assets tables', async () => {
    const { store, campaign, db } = await newTestCampaign(space);
    const folder = path.join(store.campaignsDir, campaign.id);
    expect(statSync(path.join(folder, ASSETS_FOLDER)).isDirectory()).toBe(true);
    expect(existsSync(path.join(folder, CAMPAIGN_DATABASE_FILE))).toBe(true);
    expect(countRows(db, 'assets')).toBe(0);
    expect(countRows(db, 'asset_versions')).toBe(0);
  });

  it('ARCH-031: a closed campaign folder, copied elsewhere, opens with identical turns', async () => {
    const { store, campaign, db } = await newTestCampaign(space);
    const root = testTurn();
    const main = testBranch(root);
    insertRootTurn(db, { branch: main, turn: root, sets: [testSet(root, 'setup', [])] });
    const turn = testTurn(root);
    insertTurn(db, {
      branchId: main.id,
      turn,
      sets: [testSet(turn, 'input', [inputPayload('I open the letter.')])],
    });
    const turns = readTurnsOnBranch(db, main.id, null, 10);
    store.closeCampaign(campaign.id);

    const elsewhere = space.store();
    cpSync(
      path.join(store.campaignsDir, campaign.id),
      path.join(elsewhere.campaignsDir, campaign.id),
      { recursive: true },
    );
    const copy = opened(elsewhere.openCampaign(campaign.id));
    expect(readTurnsOnBranch(copy, main.id, null, 10)).toEqual(turns);
    expect(elsewhere.readCampaign(copy)).toEqual(campaign);
  });

  it('ARCH-031: deleting an open campaign closes it and removes its folder', async () => {
    const { store, campaign, db } = await newTestCampaign(space);
    expect(await store.deleteCampaign(campaign.id)).toEqual({ ok: true, value: undefined });
    expect(db.isOpen).toBe(false);
    expect(existsSync(path.join(store.campaignsDir, campaign.id))).toBe(false);
    expect((await store.deleteCampaign(campaign.id)).ok).toBe(false);
  });

  it('ARCH-031: opening a campaign that does not exist is not_found, and creates nothing', () => {
    const store = space.store();
    const missing = randomUUID();
    mkdirSync(path.join(store.campaignsDir, missing), { recursive: true });
    for (const campaignId of [missing, randomUUID(), '../escape']) {
      const result = store.openCampaign(campaignId);
      expect(result.ok ? null : result.error.code).toBe('not_found');
    }
    expect(existsSync(path.join(store.campaignsDir, missing, CAMPAIGN_DATABASE_FILE))).toBe(false);
  });

  it('ARCH-031: the store keeps one connection per campaign and lists campaigns by ID', async () => {
    const store = space.store();
    const ids = [randomUUID(), randomUUID()];
    for (const id of ids) await store.createCampaignFolder(testCampaign({ id }));
    mkdirSync(path.join(store.campaignsDir, 'not-a-campaign'));
    mkdirSync(path.join(store.campaignsDir, randomUUID())); // no database in it

    expect(await store.listCampaigns()).toEqual([...ids].sort());
    const first = opened(store.openCampaign(ids[0] ?? ''));
    expect(opened(store.openCampaign(ids[0] ?? ''))).toBe(first);
  });

  it('ARCH-031: touchLastPlayed sets the last-played time to now', async () => {
    let now = TEST_NOW;
    const store = space.store({ now: () => now });
    const campaign = testCampaign();
    const db = await store.createCampaignFolder(campaign);
    now = new Date('2026-11-06T08:30:00.000Z');
    store.touchLastPlayed(db);
    expect(store.readCampaign(db)).toEqual({ ...campaign, lastPlayedAt: now.toISOString() });
  });
});

describe('retention', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function campaignWithCalls(modelCallRecordDays: number | null) {
    const dataDir = space.folder();
    const campaign = testCampaign();
    const first = space.store({ dataDir });
    const db = await first.createCampaignFolder(campaign);
    const calls = [40, 10].map((days): ModelCallRecord => ({
      id: randomUUID(),
      campaignId: campaign.id,
      turnId: null,
      role: 'narrator',
      providerId: 'mock',
      profileId: 'mock-profile',
      model: 'mock-model',
      messages: [],
      tiers: [],
      retrieved: [],
      templates: [],
      attempts: [],
      outcome: 'success',
      createdAt: new Date(TEST_NOW.getTime() - days * DAY_MS).toISOString(),
    }));
    for (const call of calls) insertModelCall(db, call);
    first.closeAll();
    const reopened = space.store({ dataDir, modelCallRecordDays: () => modelCallRecordDays });
    return { db: opened(reopened.openCampaign(campaign.id)), calls };
  }

  it('ARCH-061: with 30 days set, only the 10-day-old record survives the open', async () => {
    const { db, calls } = await campaignWithCalls(30);
    expect(calls.map((call) => readModelCall(db, call.id)?.id ?? null)).toEqual([
      null,
      calls[1]?.id,
    ]);
  });

  it('ARCH-061: with retention null, every record is kept', async () => {
    const { db, calls } = await campaignWithCalls(null);
    expect(calls.map((call) => readModelCall(db, call.id)?.id)).toEqual(calls.map((c) => c.id));
  });
});
