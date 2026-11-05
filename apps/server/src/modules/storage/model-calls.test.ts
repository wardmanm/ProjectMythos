import { randomUUID } from 'node:crypto';
import type { ModelCallRecord } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { CampaignRecord } from './rows';
import { insertModelCall, listModelCalls, pruneModelCalls, readModelCall } from './model-calls';
import { createTestSpace, newTestCampaign, TEST_NOW, testBranch, testTurn } from './testing';
import { insertRootTurn } from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(TEST_NOW.getTime() - days * DAY_MS).toISOString();

function record(
  campaign: CampaignRecord,
  turnId: string | null,
  createdAt: string,
): ModelCallRecord {
  return {
    id: randomUUID(),
    campaignId: campaign.id,
    turnId,
    role: 'narrator',
    providerId: 'mock',
    profileId: 'mock-profile',
    model: 'mock-model',
    messages: [],
    tiers: [],
    retrieved: [],
    templates: ['engine/narrator.md'],
    attempts: [],
    outcome: 'success',
    createdAt,
  };
}

describe('model call records', () => {
  it('ARCH-060: records read back whole, per turn, in the order they were written', async () => {
    const { db, campaign } = await newTestCampaign(space);
    const turn = testTurn();
    insertRootTurn(db, { branch: testBranch(turn), turn, sets: [] });
    const later = record(campaign, turn.id, daysAgo(1));
    const earlier = record(campaign, turn.id, daysAgo(2));
    const unrelated = record(campaign, null, daysAgo(1));
    for (const call of [later, earlier, unrelated]) insertModelCall(db, call);

    expect(listModelCalls(db, turn.id)).toEqual([later, earlier]);
    expect(readModelCall(db, unrelated.id)).toEqual(unrelated);
    expect(readModelCall(db, randomUUID())).toBeNull();
  });

  it('ARCH-061: pruning deletes only records older than the cutoff', async () => {
    const { db, campaign } = await newTestCampaign(space);
    const old = record(campaign, null, daysAgo(40));
    const recent = record(campaign, null, daysAgo(10));
    insertModelCall(db, old);
    insertModelCall(db, recent);

    expect(pruneModelCalls(db, daysAgo(30))).toBe(1);
    expect(readModelCall(db, old.id)).toBeNull();
    expect(readModelCall(db, recent.id)).toEqual(recent);
  });
});
