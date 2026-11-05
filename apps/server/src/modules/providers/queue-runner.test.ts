// What follows a run, through the queue: preemption, retries with backoff, and failure.
import { type AppError, err, ok } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { mockProviderError } from './mock-outputs';
import {
  type ConfigInput,
  createQueueSpace,
  flush,
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

describe('preemption', () => {
  it('PRV-064: an interactive job preempts a running background job on its device, which then resumes', async () => {
    const t = await setup();
    const jobId = t.enqueue('extraction');
    const done = t.queue.wait(jobId);
    await flush();
    const preempted = t.held.runs[0]!;
    const work = heldWork<string>();
    const { result } = t.queue.runInteractive(t.interactive, work.work);
    await flush();
    expect(preempted.ctx.signal.aborted).toBe(true);
    expect(work.runs).toHaveLength(0); // the slot frees when the preempted run settles

    preempted.finish(err(mockProviderError('cancelled')));
    await flush();
    work.runs[0]!.finish(ok('The door opens.'));
    expect(await result).toEqual(ok('The door opens.'));
    await flush();
    const resumed = t.held.runs[1]!;
    expect([resumed.label, resumed.ctx.attempt]).toEqual(['extraction', 1]);
    resumed.finish(ok(undefined));
    expect(await done).toEqual(ok(undefined));
    const statuses = statusesOf(t.events(), jobId);
    expect(statuses).toEqual(['queued', 'running', 'queued', 'running', 'succeeded']);
    expect(t.events().at(-1)).toMatchObject({ id: jobId, attempts: 1 });
  });

  it('PRV-064: with every slot running background jobs, the one started last is preempted; if it still returns ok, it succeeds', async () => {
    const t = await setup({ devices: [{ id: 'gpu', name: 'GPU', concurrency: 2 }] });
    t.enqueue('older');
    await flush();
    const newer = t.enqueue('newer');
    await flush();
    const work = heldWork<undefined>();
    t.queue.runInteractive(t.interactive, work.work);
    await flush();
    const [olderRun, newerRun] = t.held.runs;
    expect([olderRun!.ctx.signal.aborted, newerRun!.ctx.signal.aborted]).toEqual([false, true]);

    newerRun!.finish(ok(undefined));
    await flush();
    expect(work.runs).toHaveLength(1);
    expect(statusesOf(t.events(), newer).at(-1)).toBe('succeeded');
    expect(t.held.runs).toHaveLength(2);
  });

  it('PRV-064: with preemptBackground off, an interactive job waits for a free slot', async () => {
    const t = await setup({ queue: { preemptBackground: false } });
    t.enqueue('extraction');
    await flush();
    const work = heldWork<undefined>();
    t.queue.runInteractive(t.interactive, work.work);
    await flush();
    expect([t.held.runs[0]!.ctx.signal.aborted, work.runs.length]).toEqual([false, 0]);

    t.held.runs[0]!.finish(ok(undefined));
    await flush();
    expect(work.runs).toHaveLength(1);
  });
});

describe('retries', () => {
  it('PRV-063: retryable failures back off 2 s, 8 s, then 30 s at most, until maxAttempts; then the job fails and onFailed runs', async () => {
    const t = await setup({ queue: { maxAttempts: 5 } });
    const jobId = t.enqueue('flaky');
    const done = t.queue.wait(jobId);
    const failure = mockProviderError('provider_unavailable');
    await flush();
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const run = t.held.runs[attempt - 1]!;
      expect(run.ctx.attempt).toBe(attempt);
      run.finish(err(failure));
      await flush();
      if (attempt === 5) break;
      t.timer.advance(t.timer.delays.at(-1)! - 1);
      await flush();
      expect(t.held.runs).toHaveLength(attempt);
      t.timer.advance(1);
      await flush();
    }
    expect(t.timer.delays).toEqual([2000, 8000, 30_000, 30_000]);
    expect(await done).toEqual(err(failure));
    await flush();
    expect(t.held.failures).toEqual([{ payload: { label: 'flaky' }, error: failure }]);
    expect(statusesOf(t.events(), jobId).at(-1)).toBe('failed');
    expect(t.events().at(-1)).toMatchObject({ id: jobId, attempts: 5 });
  });

  it.each<[string, AppError]>([
    ['provider_rejected, marked not retryable', mockProviderError('provider_rejected')],
    ['an error without retryable: true', { code: 'provider_timeout', message: 'No reply.' }],
  ])('PRV-063: a non-retryable failure (%s) fails the job at once', async (_name, failure) => {
    const t = await setup();
    const jobId = t.enqueue('doomed');
    const done = t.queue.wait(jobId);
    await flush();
    t.held.runs[0]!.finish(err(failure));
    expect(await done).toEqual(err(failure));
    await flush();
    expect([t.timer.delays, t.held.runs.length, t.held.failures.length]).toEqual([[], 1, 1]);
  });

  it('PRV-063: a retryAfterSeconds longer than the backoff sets the wait, and a shorter one does not', async () => {
    const t = await setup();
    t.enqueue('limited');
    await flush();
    const limited = (seconds: number) => ({
      ...mockProviderError('rate_limited'),
      details: { retryAfterSeconds: seconds },
    });
    t.held.runs[0]!.finish(err(limited(45)));
    await flush();
    t.timer.advance(45_000);
    await flush();
    t.held.runs[1]!.finish(err(limited(1)));
    await flush();
    expect(t.timer.delays).toEqual([45_000, 8000]);
  });

  it('PRV-063: a handler that throws fails its job with internal_error, logged, and not retried', async () => {
    const t = await setup();
    t.queue.register({
      ...heldHandler({ type: 'throws' }).handler,
      run() {
        throw new Error('boom');
      },
    });
    const jobId = t.enqueue('throws', 'gpu', 'throws');
    const done = await t.queue.wait(jobId);
    expect(done.ok ? null : done.error.code).toBe('internal_error');
    expect(t.logEntries.map((entry) => entry.message)).toEqual(['a job threw']);
    expect(t.timer.delays).toEqual([]);
  });

  it('PRV-051: runInteractive retries a transient provider error with the same backoff', async () => {
    const t = await setup();
    const work = heldWork<string>();
    const { result } = t.queue.runInteractive(t.interactive, work.work);
    await flush();
    work.runs[0]!.finish(err(mockProviderError('provider_timeout')));
    await flush();
    expect(t.timer.delays).toEqual([2000]);
    t.timer.advance(2000);
    await flush();
    expect(work.runs[1]!.ctx.attempt).toBe(2);
    work.runs[1]!.finish(ok('A gull cries.'));
    expect(await result).toEqual(ok('A gull cries.'));
  });
});
