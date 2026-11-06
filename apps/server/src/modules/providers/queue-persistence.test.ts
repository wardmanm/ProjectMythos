import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { err, ok } from '@mythos/contracts';
import { cmp } from '@mythos/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CampaignStore,
  type Database,
  insertJob,
  listUnfinishedJobs,
  type PersistedJob,
} from '../storage';
import { mockProviderError } from './mock-outputs';
import {
  createQueueSpace,
  flush,
  heldHandler,
  heldWork,
  newCampaign,
  statusesOf,
  TEST_START,
  testConfig,
} from './queue-testing';

const space = createQueueSpace();
afterEach(() => {
  space.cleanUp();
});

const twoDevices = {
  devices: [
    { id: 'gpu', name: 'GPU' },
    { id: 'cloud', name: 'Cloud' },
  ],
};

function open(store: CampaignStore, campaignId: string): Database {
  const opened = store.openCampaign(campaignId);
  if (!opened.ok) throw new Error(opened.error.message);
  return opened.value;
}

/** A row as an earlier process would have left it. */
function storedJob(
  label: string,
  status: PersistedJob['status'],
  overrides: Partial<PersistedJob> = {},
): PersistedJob {
  const at = new Date(TEST_START).toISOString();
  return {
    id: randomUUID(),
    type: 'test-job',
    priority: 'extraction',
    deviceId: 'gpu',
    status,
    attempts: 0,
    turnId: null,
    payload: { label },
    lastError: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

/** A queue on `store` with the held `test-job` type registered. */
function startQueue(store: CampaignStore, input = {}) {
  const harness = space.queue(store, testConfig(input));
  const held = heldHandler();
  harness.queue.register(held.handler);
  const enqueue = (campaignId: string, label: string, deviceId = 'gpu') => {
    const payload = { label };
    const result = harness.queue.enqueue({
      type: 'test-job',
      payload,
      deviceId,
      campaignId,
      turnId: null,
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.jobId;
  };
  return { ...harness, held, enqueue };
}

/** The data directory a store was opened on, to open it again as a restarted server. */
const dataDirOf = (store: CampaignStore) => path.dirname(store.campaignsDir);

describe('restarts', () => {
  it('ARCH-082: a persisted job survives a simulated restart and runs once', async () => {
    const before = space.store();
    const campaignId = await newCampaign(before);
    const crashed = startQueue(before);
    const jobId = crashed.enqueue(campaignId, 'extract turn 3');
    await flush();
    expect(crashed.held.runs).toHaveLength(1); // running when the process dies

    const after = space.store(dataDirOf(before));
    const restarted = startQueue(after);
    await restarted.queue.resume();
    await flush();
    expect(restarted.held.labels()).toEqual(['extract turn 3']);
    expect(restarted.held.runs[0]!.ctx).toMatchObject({ jobId, attempt: 1 });
    restarted.held.runs[0]!.finish(ok(undefined));
    await flush();
    expect(statusesOf(restarted.events(), jobId)).toEqual(['queued', 'running', 'succeeded']);

    const again = startQueue(space.store(dataDirOf(before)));
    await again.queue.resume();
    await flush();
    expect(again.held.runs).toHaveLength(0);
  });

  it('ARCH-082: stop() stores a running background job as queued without counting an attempt, and cancels interactive work', async () => {
    const before = space.store();
    const campaignId = await newCampaign(before);
    const first = startQueue(before, { devices: [{ id: 'gpu', name: 'GPU', concurrency: 2 }] });
    const jobId = first.enqueue(campaignId, 'cut off');
    const work = heldWork<string>();
    const interactive = first.queue.runInteractive(
      { deviceId: 'gpu', campaignId, turnId: null },
      work.work,
    );
    await flush();
    const stopping = first.queue.stop();
    const background = first.held.runs[0]!;
    expect([background.ctx.signal.aborted, work.runs[0]!.ctx.signal.aborted]).toEqual([true, true]);
    background.finish(err(mockProviderError('cancelled')));
    work.runs[0]!.finish(err(mockProviderError('cancelled')));
    await stopping;
    expect(await interactive.result).toEqual(err(mockProviderError('cancelled')));
    const stored = listUnfinishedJobs(open(before, campaignId));
    expect(stored).toMatchObject([{ id: jobId, status: 'queued', attempts: 0 }]);
    expect(() => first.enqueue(campaignId, 'too late')).toThrow(/stopped/);

    const next = startQueue(space.store(dataDirOf(before)));
    await next.queue.resume();
    await flush();
    expect(next.held.runs[0]!.ctx).toMatchObject({ jobId, attempt: 1 });
  });
});

describe('resuming stored jobs', () => {
  it('PRV-062: resume takes back every campaign’s queued and running jobs, in stored order, attempts unchanged', async () => {
    const store = space.store();
    const [first, second] = [await newCampaign(store), await newCampaign(store)];
    const done = storedJob('done', 'succeeded');
    const cutOff = storedJob('gpu 2', 'running', { attempts: 1 });
    for (const job of [storedJob('gpu 1', 'queued'), done, cutOff]) {
      insertJob(open(store, first), job);
    }
    for (const label of ['cloud 1', 'cloud 2']) {
      insertJob(open(store, second), storedJob(label, 'queued', { deviceId: 'cloud' }));
    }
    const t = startQueue(store, twoDevices);
    await t.queue.resume();
    await flush();
    expect(t.held.labels().sort(cmp)).toEqual(['cloud 1', 'gpu 1']);

    t.held.runs[0]!.finish(ok(undefined));
    t.held.runs[1]!.finish(ok(undefined));
    await flush();
    expect(t.held.labels().slice(2).sort(cmp)).toEqual(['cloud 2', 'gpu 2']);
    const resumed = t.held.runs.find((run) => run.label === 'gpu 2');
    expect(resumed?.ctx.attempt).toBe(2);
    expect(statusesOf(t.events(), cutOff.id)).toEqual(['queued', 'running']);
    expect(statusesOf(t.events(), done.id)).toEqual([]);
  });

  it('PRV-062: a stored job with no handler, or a payload its handler rejects, is marked failed, and the rest still resume', async () => {
    const store = space.store();
    const campaignId = await newCampaign(store);
    const retired = storedJob('retired', 'queued', { type: 'retired-job' });
    const corrupt = storedJob('', 'queued');
    for (const job of [retired, corrupt, storedJob('fine', 'queued')]) {
      insertJob(open(store, campaignId), job);
    }
    const t = startQueue(store);
    await t.queue.resume();
    await flush();
    expect(t.held.labels()).toEqual(['fine']);
    expect(statusesOf(t.events(), retired.id)).toEqual(['failed']);
    expect(statusesOf(t.events(), corrupt.id)).toEqual(['failed']);
    const stillStored = listUnfinishedJobs(open(store, campaignId)).map((job) => job.payload);
    expect(stillStored).toEqual([{ label: 'fine' }]);
    expect(t.logEntries.map((entry) => entry.level)).toEqual(['warn', 'warn']);
  });

  it('PRV-062: a campaign that fails to open is logged and skipped, and the others resume', async () => {
    const store = space.store();
    const broken = randomUUID();
    mkdirSync(path.join(store.campaignsDir, broken), { recursive: true });
    writeFileSync(path.join(store.campaignsDir, broken, 'campaign.sqlite'), 'not a database');
    const campaignId = await newCampaign(store);
    insertJob(open(store, campaignId), storedJob('fine', 'queued'));
    const t = startQueue(store);
    await t.queue.resume();
    await flush();
    expect(t.held.labels()).toEqual(['fine']);
    expect(t.logEntries).toMatchObject([{ level: 'error', fields: { campaignId: broken } }]);
  });

  it('PRV-062: before a campaign’s first new job, the queue takes back its stored jobs, once per process', async () => {
    const store = space.store();
    const campaignId = await newCampaign(store);
    insertJob(open(store, campaignId), storedJob('left over', 'queued'));
    const t = startQueue(store);
    t.enqueue(campaignId, 'new');
    await flush();
    await t.queue.resume(); // the campaign is taken back already, so this adds nothing
    for (let i = 0; i < 2; i += 1) {
      await flush();
      t.held.runs[i]!.finish(ok(undefined));
    }
    await flush();
    expect(t.held.labels()).toEqual(['left over', 'new']);
  });
});

describe('job.updated', () => {
  it('PRV-065: every status change is stored first, then published on the campaign’s stream', async () => {
    const store = space.store();
    const campaignId = await newCampaign(store);
    const t = startQueue(store);
    const db = open(store, campaignId);
    const seen: { status: string; attempts: number; stored: string }[] = [];
    t.bus.subscribe(campaignId, null, (event) => {
      if (event.payload.type !== 'job.updated') return;
      const { job } = event.payload;
      const row = listUnfinishedJobs(db).find((stored) => stored.id === job.id);
      seen.push({ status: job.status, attempts: job.attempts, stored: row?.status ?? 'finished' });
    });
    t.enqueue(campaignId, 'retried');
    await flush();
    t.held.runs[0]!.finish(err(mockProviderError('provider_timeout')));
    await flush();
    t.timer.advance(2000);
    await flush();
    t.held.runs[1]!.finish(ok(undefined));
    await flush();
    expect(seen).toEqual([
      { status: 'queued', attempts: 0, stored: 'queued' },
      { status: 'running', attempts: 0, stored: 'running' },
      { status: 'queued', attempts: 1, stored: 'queued' },
      { status: 'running', attempts: 1, stored: 'running' },
      { status: 'succeeded', attempts: 2, stored: 'finished' },
    ]);
  });

  it('PRV-067: an interactive job publishes on its campaign’s stream, and one with a null campaignId publishes nothing', async () => {
    const store = space.store();
    const campaignId = await newCampaign(store);
    const t = startQueue(store);
    const probe = t.queue.runInteractive({ deviceId: 'gpu', campaignId: null, turnId: null }, () =>
      Promise.resolve(ok('pong')),
    );
    expect(await probe.result).toEqual(ok('pong'));
    const narration = t.queue.runInteractive({ deviceId: 'gpu', campaignId, turnId: null }, () =>
      Promise.resolve(ok('The tide turns.')),
    );
    await narration.result;
    await flush();
    expect(t.published.map((event) => event.campaignId)).toEqual([
      campaignId,
      campaignId,
      campaignId,
    ]);
    expect(statusesOf(t.events(), narration.jobId)).toEqual(['queued', 'running', 'succeeded']);
  });

  it('ARCH-131: every job record carries its device and priority', async () => {
    const store = space.store();
    const campaignId = await newCampaign(store);
    const t = startQueue(store, twoDevices);
    const ticks = heldHandler({ type: 'test-tick', priority: 'world-tick', runs: t.held.runs });
    t.queue.register(ticks.handler);
    t.queue.enqueue({
      type: 'test-tick',
      payload: { label: 'tick' },
      deviceId: 'cloud',
      campaignId,
      turnId: null,
    });
    t.queue.runInteractive(
      { deviceId: 'gpu', campaignId, turnId: null },
      heldWork<undefined>().work,
    );
    await flush();
    const records = t
      .events()
      .map(({ type, deviceId, priority }) => ({ type, deviceId, priority }));
    expect(new Set(records.map((record) => JSON.stringify(record)))).toEqual(
      new Set([
        JSON.stringify({ type: 'test-tick', deviceId: 'cloud', priority: 'world-tick' }),
        JSON.stringify({ type: 'interactive', deviceId: 'gpu', priority: 'interactive' }),
      ]),
    );
  });
});
