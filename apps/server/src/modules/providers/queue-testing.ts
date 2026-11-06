// Helpers for the job queue's own tests: a fake backoff timer and time source, gates
// that hold a run open until the test ends it, a machine config the test can edit, and
// campaigns in fresh os.tmpdir() folders. Not exported from index.ts.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AppError,
  type DeviceSchema,
  err,
  type Job,
  type JobPriority,
  type MachineConfig,
  MachineConfigSchema,
  ok,
  type Result,
  type ServerEvent,
} from '@mythos/contracts';
import { z } from 'zod';
import { createEventBus } from '../events';
import { type CampaignRecord, type CampaignStore, createCampaignStore } from '../storage';
import {
  createJobQueue,
  type JobContext,
  type JobHandler,
  type JobQueueOptions,
  type QueueLogger,
} from './queue';

/** The wall time a test starts at; the fake timer moves it on. */
export const TEST_START = Date.parse('2026-11-05T12:00:00.000Z');

/** Lets every microtask run, so the queue finishes whatever a step started. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A promise the test resolves when it chooses. */
export function gate<T>(): { promise: Promise<T>; open: (value: T) => void } {
  let open: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/**
 * A backoff timer and time source that move only when the test says. `delays` lists the
 * wait of every timer started, in order, and `pending` how many have neither fired nor
 * been cleared.
 */
export function createFakeTimer() {
  let elapsed = 0;
  const timers = new Set<{ due: number; callback: () => void }>();
  const delays: number[] = [];
  return {
    delays,
    pending: () => timers.size,
    timeSource: { now: () => TEST_START + elapsed },
    setTimer: ((ms, callback) => {
      delays.push(ms);
      const timer = { due: elapsed + ms, callback };
      timers.add(timer);
      return () => timers.delete(timer);
    }) satisfies JobQueueOptions['setTimer'],
    /** Moves time on by `ms`, firing each timer that falls due, earliest first. */
    advance(ms: number): void {
      elapsed += ms;
      const due = [...timers].filter((timer) => timer.due <= elapsed);
      for (const timer of due.sort((a, b) => a.due - b.due)) {
        timers.delete(timer);
        timer.callback();
      }
    },
  };
}

type DeviceInput = z.input<typeof DeviceSchema>;
type QueueInput = z.input<typeof MachineConfigSchema>['queue'];
export type ConfigInput = { devices?: DeviceInput[]; queue?: QueueInput };

function machineConfig({ devices = [{ id: 'gpu', name: 'GPU' }], queue }: ConfigInput) {
  const deviceId = devices[0]?.id ?? 'gpu';
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices,
    providers: [{ id: 'mock', type: 'mock', deviceId }],
    queue,
  });
}

/** A machine config the test can replace, or break, between scheduling decisions. */
export function testConfig(input: ConfigInput = {}) {
  let state: Result<MachineConfig, AppError> = ok(machineConfig(input));
  return {
    current: () => state,
    set(next: ConfigInput): void {
      state = ok(machineConfig(next));
    },
    break(): void {
      state = err({ code: 'validation_failed', message: 'machine-config.json is broken' });
    },
  };
}

/** A logger that keeps what it is given, for assertions. */
export function recordingLogger() {
  const entries: { level: 'warn' | 'error'; fields: Record<string, unknown>; message: string }[] =
    [];
  const logger: QueueLogger = {
    warn: (fields, message) => entries.push({ level: 'warn', fields, message }),
    error: (fields, message) => entries.push({ level: 'error', fields, message }),
  };
  return { logger, entries };
}

/** A campaign record for a campaign made from the reference pack's *Arrival*. */
export function testCampaignRecord(): CampaignRecord {
  const createdAt = new Date(TEST_START).toISOString();
  return {
    id: randomUUID(),
    name: 'Queue test',
    packId: 'reference',
    packVersion: '1.0.0',
    settingId: 'setting.brinemoor',
    scenarioId: 'scenario.arrival',
    toneProfileId: 'tone.coastal-mystery',
    rulesetId: 'ruleset.standard',
    themeId: 'theme.house',
    pcId: 'pc.wren',
    firstSceneId: randomUUID(),
    createdAt,
    lastPlayedAt: createdAt,
  };
}

export const TestPayloadSchema = z.strictObject({ label: z.string().min(1) });
export type TestPayload = z.infer<typeof TestPayloadSchema>;

/** One run the test is holding open, and how to end it. */
export type HeldRun = {
  label: string;
  ctx: JobContext;
  finish: (result: Result<void, AppError>) => void;
};

/**
 * A persisted test-only job type whose every run waits until the test ends it. `runs`
 * lists the runs in the order they started, and may be shared by several types;
 * `failures` lists the calls to `onFailed`.
 */
export function heldHandler(
  options: { type?: string; priority?: JobPriority; runs?: HeldRun[] } = {},
) {
  const { type = 'test-job', priority = 'extraction', runs = [] } = options;
  const failures: { payload: TestPayload; error: AppError }[] = [];
  const handler: JobHandler<TestPayload> = {
    type,
    payloadSchema: TestPayloadSchema,
    priority,
    persisted: true,
    run(payload, ctx) {
      const { promise, open } = gate<Result<void, AppError>>();
      runs.push({ label: payload.label, ctx, finish: open });
      return promise;
    },
    onFailed(payload, error) {
      failures.push({ payload, error });
      return Promise.resolve();
    },
  };
  return { handler, runs, failures, labels: () => runs.map((run) => run.label) };
}

/** Interactive work that waits until the test ends it, run by run. */
export function heldWork<T>() {
  const runs: { ctx: JobContext; finish: (result: Result<T, AppError>) => void }[] = [];
  const work = (ctx: JobContext): Promise<Result<T, AppError>> => {
    const { promise, open } = gate<Result<T, AppError>>();
    runs.push({ ctx, finish: open });
    return promise;
  };
  return { work, runs };
}

/**
 * Tracks what a test file makes, so `cleanUp` (run in `afterEach`) closes every
 * database before removing its folder: Windows cannot delete an open file.
 */
export function createQueueSpace() {
  const folders: string[] = [];
  const stores: CampaignStore[] = [];

  return {
    /** A campaign store on `dataDir`, or on a new folder in os.tmpdir() (CONV-116). */
    store(dataDir?: string): CampaignStore {
      const dir = dataDir ?? mkdtempSync(path.join(tmpdir(), 'mythos-queue-'));
      if (dataDir === undefined) folders.push(dir);
      const store = createCampaignStore({
        dataDir: dir,
        timeSource: { now: () => TEST_START },
        modelCallRecordDays: () => null,
      });
      stores.push(store);
      return store;
    },

    /**
     * A queue with fakes for everything but storage and the event bus, which are real.
     * `events` holds every `job.updated` record published, in order.
     */
    queue(store: CampaignStore, config = testConfig()) {
      const timer = createFakeTimer();
      const { logger, entries } = recordingLogger();
      const bus = createEventBus({ firstId: 1 });
      const published: ServerEvent[] = [];
      const queue = createJobQueue({
        config,
        campaigns: store,
        publish: (campaignId, payload) => {
          const event = bus.publish(campaignId, payload);
          published.push(event);
          return event;
        },
        timeSource: timer.timeSource,
        setTimer: timer.setTimer,
        logger,
      });
      const events = (): Job[] =>
        published.flatMap((event) =>
          event.payload.type === 'job.updated' ? [event.payload.job] : [],
        );
      return { queue, timer, config, bus, published, events, logEntries: entries };
    },

    cleanUp(): void {
      for (const store of stores.splice(0)) store.closeAll();
      for (const dir of folders.splice(0)) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
      }
    },
  };
}

/** A new campaign in `store`, ready for jobs. */
export async function newCampaign(store: CampaignStore): Promise<string> {
  const record = testCampaignRecord();
  await store.createCampaignFolder(record);
  return record.id;
}

/** The statuses `events` published for one job, in order. */
export function statusesOf(events: readonly Job[], jobId: string): Job['status'][] {
  return events.filter((job) => job.id === jobId).map((job) => job.status);
}

/**
 * A queue in `space` with one campaign and the held `test-job` type at extraction
 * priority. `enqueue` adds a job of that campaign; `interactive` places one on `gpu`.
 */
export async function queueWithCampaign(
  space: ReturnType<typeof createQueueSpace>,
  input: ConfigInput = {},
) {
  const store = space.store();
  const campaignId = await newCampaign(store);
  const harness = space.queue(store, testConfig(input));
  const held = heldHandler();
  harness.queue.register(held.handler);
  function enqueue(label: string, deviceId = 'gpu', type = 'test-job'): string {
    const payload = { label };
    const result = harness.queue.enqueue({ type, payload, deviceId, campaignId, turnId: null });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.jobId;
  }
  const interactive = { deviceId: 'gpu', campaignId, turnId: null };
  return { ...harness, store, campaignId, held, enqueue, interactive };
}
