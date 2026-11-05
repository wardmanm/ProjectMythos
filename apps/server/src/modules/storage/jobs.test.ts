import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { insertJob, listUnfinishedJobs, updateJob } from './jobs';
import type { PersistedJob } from './rows';
import { createTestSpace, TEST_NOW, testCampaign } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

function job(status: PersistedJob['status'], payload: PersistedJob['payload']): PersistedJob {
  return {
    id: randomUUID(),
    type: 'extraction',
    priority: 'extraction',
    deviceId: 'this-computer',
    status,
    attempts: 0,
    turnId: null,
    payload,
    lastError: null,
    createdAt: TEST_NOW.toISOString(),
    updatedAt: TEST_NOW.toISOString(),
  };
}

describe('jobs', () => {
  it('PRV-062: queued and running jobs survive a close and reopen, in order, with their payloads', async () => {
    const dataDir = space.folder();
    const campaign = testCampaign();
    const first = space.store({ dataDir });
    const db = await first.createCampaignFolder(campaign);
    const running = job('running', { setId: randomUUID(), attempt: [1, 2] });
    const done = job('succeeded', {});
    const queued = job('queued', { note: 'second' });
    for (const each of [running, done, queued]) insertJob(db, each);
    first.closeAll();

    const reopened = space.store({ dataDir }).openCampaign(campaign.id);
    if (!reopened.ok) throw new Error(reopened.error.message);
    expect(listUnfinishedJobs(reopened.value)).toEqual([running, queued]);
  });

  it('PRV-062: an update records status, attempts, and the last error', async () => {
    const store = space.store();
    const db = await store.createCampaignFolder(testCampaign());
    const queued = job('queued', null);
    insertJob(db, queued);
    const lastError = { code: 'provider_timeout' as const, message: 'No reply in 60 s.' };
    updateJob(db, queued.id, {
      status: 'queued',
      attempts: 1,
      lastError,
      updatedAt: '2026-11-05T12:01:00.000Z',
    });
    expect(listUnfinishedJobs(db)).toEqual([
      { ...queued, attempts: 1, lastError, updatedAt: '2026-11-05T12:01:00.000Z' },
    ]);

    updateJob(db, queued.id, {
      status: 'failed',
      attempts: 3,
      lastError,
      updatedAt: '2026-11-05T12:02:00.000Z',
    });
    expect(listUnfinishedJobs(db)).toEqual([]);
    expect(() => {
      updateJob(db, randomUUID(), {
        status: 'failed',
        attempts: 1,
        lastError: null,
        updatedAt: '2026-11-05T12:02:00.000Z',
      });
    }).toThrow(/no job/);
  });
});
