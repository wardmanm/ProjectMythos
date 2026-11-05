// The queue's public surface: scheduling order, waiting, interactive jobs, cancelling,
// and registering. Preemption and retries are in queue-runner.test.ts, and storage,
// resume, and events in queue-persistence.test.ts.
import { randomUUID } from 'node:crypto';
import { err, ok } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { listUnfinishedJobs } from '../storage';
import { mockProviderError } from './mock-outputs';
import {
  type ConfigInput,
  createQueueSpace,
  flush,
  type HeldRun,
  heldHandler,
  heldWork,
  queueWithCampaign,
  statusesOf,
} from './queue-testing';

const space = createQueueSpace();
afterEach(() => {
  space.cleanUp();
});

const setup = (input: ConfigInput = {}) => queueWithCampaign(space, input);

describe('scheduling', () => {
  it('ARCH-080, PRV-060: a free slot takes the highest-priority job, oldest first within a priority', async () => {
    const t = await setup();
    const runs: HeldRun[] = [];
    for (const priority of ['extraction', 'world-tick', 'consolidation', 'media'] as const) {
      t.queue.register(heldHandler({ type: priority, priority, runs }).handler);
    }
    const blocker = heldWork<undefined>();
    t.queue.runInteractive(t.interactive, blocker.work);
    await flush();
    for (const label of ['media', 'consolidation', 'world-tick']) t.enqueue(label, 'gpu', label);
    t.enqueue('extraction 1', 'gpu', 'extraction');
    t.enqueue('extraction 2', 'gpu', 'extraction');
    const late = heldWork<undefined>();
    t.queue.runInteractive(t.interactive, late.work);
    await flush();

    blocker.runs[0]!.finish(ok(undefined));
    await flush();
    expect([late.runs.length, runs.length]).toEqual([1, 0]);
    late.runs[0]!.finish(ok(undefined));
    for (let i = 0; i < 5; i += 1) {
      await flush();
      expect(runs).toHaveLength(i + 1);
      runs[i]!.finish(ok(undefined));
    }
    const order = runs.map((run) => run.label);
    expect(order).toEqual(['extraction 1', 'extraction 2', 'world-tick', 'consolidation', 'media']);
  });

  it('ARCH-081: two devices run in parallel, and a device with concurrency 1 runs one job at a time, highest priority first', async () => {
    const t = await setup({
      devices: [
        { id: 'gpu', name: 'GPU' },
        { id: 'cloud', name: 'Cloud' },
      ],
    });
    t.queue.register(
      heldHandler({ type: 'test-media', priority: 'media', runs: t.held.runs }).handler,
    );
    t.enqueue('gpu first');
    t.enqueue('gpu media', 'gpu', 'test-media');
    t.enqueue('gpu extraction');
    t.enqueue('cloud', 'cloud');
    await flush();
    expect(t.held.labels()).toEqual(['gpu first', 'cloud']);

    t.held.runs[0]!.finish(ok(undefined));
    await flush();
    expect(t.held.labels()).toEqual(['gpu first', 'cloud', 'gpu extraction']);
    t.held.runs[2]!.finish(ok(undefined));
    await flush();
    expect(t.held.labels()).toEqual(['gpu first', 'cloud', 'gpu extraction', 'gpu media']);
  });

  it('PRV-060: a device runs up to its concurrency, which is read again at every scheduling decision', async () => {
    const t = await setup({ devices: [{ id: 'gpu', name: 'GPU', concurrency: 2 }] });
    for (const label of ['1', '2', '3', '4']) t.enqueue(label);
    await flush();
    expect(t.held.labels()).toEqual(['1', '2']);

    t.config.set({ devices: [{ id: 'gpu', name: 'GPU', concurrency: 3 }] });
    t.held.runs[0]!.finish(ok(undefined));
    await flush();
    expect(t.held.labels()).toEqual(['1', '2', '3', '4']);
  });

  it('ARCH-081: a device missing from machine config, and every device while it fails to load, runs one job at a time', async () => {
    const t = await setup({ devices: [{ id: 'gpu', name: 'GPU', concurrency: 4 }] });
    t.enqueue('attic 1', 'attic-pc');
    t.enqueue('attic 2', 'attic-pc');
    await flush();
    expect(t.held.labels()).toEqual(['attic 1']);

    t.config.break();
    t.enqueue('gpu 1');
    t.enqueue('gpu 2');
    await flush();
    expect(t.held.labels()).toEqual(['attic 1', 'gpu 1']);
  });
});

describe('waiting', () => {
  it('PRV-063: wait resolves when the job ends, and with not_found for a job the queue does not hold', async () => {
    const t = await setup();
    const unknown = await t.queue.wait(randomUUID());
    expect(unknown.ok ? null : unknown.error.code).toBe('not_found');
    const jobId = t.enqueue('quick');
    const done = t.queue.wait(jobId);
    await flush();
    t.held.runs[0]!.finish(ok(undefined));
    expect(await done).toEqual(ok(undefined));
    const late = await t.queue.wait(jobId); // finished jobs are forgotten
    expect(late.ok ? null : late.error.code).toBe('not_found');
  });
});

describe('interactive jobs and cancelling', () => {
  it('PRV-067: runInteractive runs the work in a slot on its device, at interactive priority, and returns what it returned', async () => {
    const t = await setup();
    const first = heldWork<string>();
    const second = heldWork<string>();
    const a = t.queue.runInteractive(t.interactive, first.work);
    const b = t.queue.runInteractive(t.interactive, second.work);
    await flush();
    expect([first.runs.length, second.runs.length]).toEqual([1, 0]);

    first.runs[0]!.finish(ok('one'));
    expect(await a.result).toEqual(ok('one'));
    await flush();
    second.runs[0]!.finish(err(mockProviderError('provider_rejected')));
    expect(await b.result).toEqual(err(mockProviderError('provider_rejected')));
    const record = t.events().find((job) => job.id === a.jobId);
    expect(record).toMatchObject({ type: 'interactive', priority: 'interactive', deviceId: 'gpu' });
  });

  it('PRV-061: interactive jobs are never stored, and background jobs are', async () => {
    const t = await setup({ devices: [{ id: 'gpu', name: 'GPU', concurrency: 2 }] });
    t.queue.runInteractive(t.interactive, heldWork<undefined>().work);
    const jobId = t.enqueue('stored');
    await flush();
    const db = t.store.openCampaign(t.campaignId);
    if (!db.ok) throw new Error(db.error.message);
    expect(listUnfinishedJobs(db.value).map((job) => job.id)).toEqual([jobId]);
  });

  it('ARCH-083: cancelling a running interactive job aborts its signal, and the caller gets what the work returned', async () => {
    const t = await setup();
    const work = heldWork<string>();
    const { jobId, result } = t.queue.runInteractive(t.interactive, work.work);
    await flush();
    const run = work.runs[0]!;
    t.queue.cancel(jobId);
    expect(run.ctx.signal.aborted).toBe(true);

    run.finish(ok('The lamp gutters and')); // PRV-047: the text that arrived before the abort
    expect(await result).toEqual(ok('The lamp gutters and'));
    await flush();
    expect(statusesOf(t.events(), jobId)).toEqual(['queued', 'running', 'cancelled']);
  });

  it('ARCH-083: cancelling a queued job ends it at once, and cancelling one waiting to retry clears its timer', async () => {
    const t = await setup({
      devices: [
        { id: 'gpu', name: 'GPU' },
        { id: 'cloud', name: 'Cloud' },
      ],
    });
    t.queue.runInteractive(t.interactive, heldWork<undefined>().work);
    const queued = heldWork<undefined>();
    const waiting = t.queue.runInteractive(t.interactive, queued.work);
    const retrying = t.enqueue('retrying', 'cloud');
    const done = t.queue.wait(retrying);
    await flush();
    t.held.runs[0]!.finish(err(mockProviderError('provider_unavailable')));
    await flush();
    expect(t.timer.pending()).toBe(1);

    t.queue.cancel(waiting.jobId);
    t.queue.cancel(retrying);
    const cancelled = await waiting.result;
    expect([cancelled.ok ? null : cancelled.error.code, queued.runs.length]).toEqual([
      'cancelled',
      0,
    ]);
    const ended = await done;
    expect([ended.ok ? null : ended.error.code, t.timer.pending()]).toEqual(['cancelled', 0]);
    expect(statusesOf(t.events(), retrying).at(-1)).toBe('cancelled');
  });

  it('PRV-066: registering a type twice, an interactive or unpersisted handler, or the type "interactive" throws; so does enqueueing an unknown type or a bad payload', async () => {
    const t = await setup();
    const register =
      (options: Parameters<typeof heldHandler>[0], persisted = true) =>
      () => {
        t.queue.register({ ...heldHandler(options).handler, persisted });
      };
    expect(register({})).toThrow(/already registered/);
    expect(register({ type: 'b' }, false)).toThrow(/persisted background/);
    expect(register({ type: 'c', priority: 'interactive' })).toThrow(/persisted background/);
    expect(register({ type: 'interactive' })).toThrow(/reserved/);

    const enqueue = (type: string, payload: unknown, campaignId = t.campaignId) =>
      t.queue.enqueue({ type, payload, deviceId: 'gpu', campaignId, turnId: null });
    expect(() => enqueue('unknown', { label: 'x' })).toThrow(/no handler/);
    expect(() => enqueue('test-job', { label: '' })).toThrow(/does not fit/);
    expect(() => enqueue('test-job', { label: 'x', count: 1n })).toThrow(/not JSON/);
    const missing = enqueue('test-job', { label: 'x' }, randomUUID()); // expected, so a Result
    expect(missing.ok ? null : missing.error.code).toBe('not_found');
  });
});
