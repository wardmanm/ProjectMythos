import type { AppError, JobPriority, Result } from '@mythos/contracts';
import type { z } from 'zod';

/**
 * Handlers are registered by job type at startup. Persisted jobs store only the type and
 * a JSON payload, so after a restart the queue finds the handler by type (ARCH-082).
 */
export type JobHandler<P> = {
  type: string; // e.g. "extraction"
  payloadSchema: z.ZodType<P>;
  priority: JobPriority;
  persisted: boolean; // true for background jobs
  run(payload: P, ctx: JobContext): Promise<Result<void, AppError>>;
  /** The failure path, run once with the last error when the job ends `failed` (PRV-063). */
  onFailed?(payload: P, error: AppError): Promise<void>;
};

export type JobContext = {
  jobId: string;
  attempt: number;
  signal: AbortSignal; // aborted on cancel or preemption
};

export type EnqueueOptions = {
  type: string;
  payload: unknown; // validated against the handler's payloadSchema on enqueue
  deviceId: string;
  campaignId: string;
  turnId: string | null;
};

/** Where an interactive job runs. `campaignId` is null for machine-level calls (PRV-092). */
export type InteractiveOptions = {
  deviceId: string;
  campaignId: string | null;
  turnId: string | null;
};

export type JobQueue = {
  register<P>(handler: JobHandler<P>): void;
  enqueue(options: EnqueueOptions): Result<{ jobId: string }, AppError>;
  cancel(jobId: string): void;
  /** Resolves when the job finishes, fails permanently, or is cancelled. */
  wait(jobId: string): Promise<Result<void, AppError>>;
  /**
   * Runs `work` as an interactive job and resolves with its result. Interactive jobs are
   * never persisted, so `work` may capture callbacks such as `onDelta` (PRV-067).
   */
  runInteractive<T>(
    options: InteractiveOptions,
    work: (ctx: JobContext) => Promise<Result<T, AppError>>,
  ): { jobId: string; result: Promise<Result<T, AppError>> };
};

// ------------------------------------------------------------------ the implementation
// Everything above is the 05-providers §6 code block, copied verbatim. Below is the one
// job queue every model call runs through (ARCH-080 to ARCH-083): it registers handlers,
// adds jobs, and takes back stored jobs. Running them is queue-runner.ts, its decisions
// are queue-policy.ts, and storing and publishing them is queue-persistence.ts.
import { randomUUID } from 'node:crypto';
import { err, ok, type TimeSource } from '@mythos/contracts';
import type { ConfigStore } from '../config';
import type { EventBus } from '../events';
import type { CampaignStore, Database } from '../storage';
import {
  createJobRecorder,
  fromStored,
  readStoredJobs,
  type RegisteredHandler,
  registeredHandler,
} from './queue-persistence';
import { cancelledError, createQueueRunner, type JobFields } from './queue-runner';

/** The queue's lifecycle, beside the verbatim `JobQueue`. The composition root calls it. */
export type JobQueueLifecycle = {
  /** At server start: re-enqueues every campaign's unfinished persisted jobs (PRV-062). */
  resume(): Promise<void>;
  /**
   * At shutdown, before campaigns close: cancels interactive jobs, aborts running
   * background jobs and stores them as `queued` once their runs settle, and clears every
   * backoff timer. The queue then accepts nothing more.
   */
  stop(): Promise<void>;
};

/** Calls `callback` once after `ms` milliseconds; the function it returns cancels that. */
export type SetTimer = (ms: number, callback: () => void) => () => void;

/** The logging the queue does, which pino's logger fits (CONV-070, CONV-071). */
export type QueueLogger = {
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
};

export type JobQueueOptions = {
  /** Read afresh at every scheduling decision (PRV-004). */
  config: Pick<ConfigStore, 'current'>;
  /** Where background jobs are stored; opened for each write, never held. */
  campaigns: Pick<CampaignStore, 'openCampaign' | 'listCampaigns'>;
  /** The event bus's `publish`, for `job.updated` (PRV-065). */
  publish: EventBus['publish'];
  /** Wall time for `createdAt` and `updatedAt` (CONV-061). */
  timeSource: TimeSource;
  /** Starts a backoff timer (PRV-063); tests pass a fake one. */
  setTimer: SetTimer;
  logger: QueueLogger;
};

/** The type, and the priority, of every job `runInteractive` starts. */
const INTERACTIVE = 'interactive';

/**
 * Builds the job queue. Called once, by the composition root (ARCH-022). Implements
 * ARCH-080 to ARCH-083, ARCH-131, PRV-051, and PRV-060 to PRV-067.
 */
export function createJobQueue(options: JobQueueOptions): JobQueue & JobQueueLifecycle {
  const { config, campaigns, setTimer, logger } = options;
  const recorder = createJobRecorder(options);
  const runner = createQueueRunner({ config, recorder, setTimer, logger });
  const handlers = new Map<string, RegisteredHandler>();
  // Campaigns whose stored jobs this process has taken back (PRV-062).
  const takenBack = new Set<string>();
  const now = () => new Date(options.timeSource.now()).toISOString();

  function assertOpen(caller: string): void {
    if (runner.isStopped()) throw new Error(`${caller}: the job queue has stopped`);
  }

  /** Puts a campaign's stored jobs back in the queue, in stored order (PRV-062). */
  function takeBack(campaignId: string, db: Database): void {
    const storedJobs = readStoredJobs(db, handlers);
    takenBack.add(campaignId);
    for (const { stored, bound } of storedJobs) {
      const job = fromStored(stored, campaignId);
      if (!bound.ok) {
        const fields = { jobId: job.id, campaignId, type: job.type, code: bound.error.code };
        logger.warn(fields, 'a stored job could not be resumed, so it failed');
        recorder.changed({ ...job, lastError: bound.error }, 'failed');
        continue;
      }
      // A job stored as running was cut off: back to queued, its attempts unchanged.
      if (stored.status === 'running') recorder.changed(job, 'queued');
      runner.add({ ...job, work: bound.value, complete: null });
    }
  }

  /** Implements PRV-067: the caller's work, in a device slot at interactive priority. */
  function runInteractive<T>(
    where: InteractiveOptions,
    work: (ctx: JobContext) => Promise<Result<T, AppError>>,
  ): { jobId: string; result: Promise<Result<T, AppError>> } {
    assertOpen('runInteractive');
    const jobId = randomUUID();
    // What the latest run returned, partial narration included (PRV-047); null while a
    // run is under way, and after one that threw.
    let returned: Result<T, AppError> | null = null;
    let resolveResult: (result: Result<T, AppError>) => void = () => undefined;
    const result = new Promise<Result<T, AppError>>((resolve) => {
      resolveResult = resolve;
    });
    const run = async (ctx: JobContext): Promise<Result<void, AppError>> => {
      returned = null;
      const value = await work(ctx);
      returned = value;
      return value.ok ? ok(undefined) : err(value.error);
    };
    // `final` is null when no run ended the job: it was cancelled while queued.
    const complete = (final: Result<void, AppError> | null): void => {
      if (final !== null && returned !== null) resolveResult(returned);
      else resolveResult(err(final === null || final.ok ? cancelledError(jobId) : final.error));
    };
    const job: JobFields = {
      ...where,
      id: jobId,
      type: INTERACTIVE,
      priority: 'interactive',
      persisted: false,
      attempts: 0,
      lastError: null,
      createdAt: now(),
      work: { run, onFailed: null },
      complete,
    };
    recorder.changed(job, 'queued');
    runner.add(job);
    return { jobId, result };
  }

  return {
    register(handler) {
      // 05-providers Decisions: handlers are for persisted background jobs only;
      // interactive work goes through runInteractive (PRV-067).
      if (handler.type === INTERACTIVE) {
        throw new Error(`register: the job type "${INTERACTIVE}" is reserved for runInteractive`);
      }
      if (handlers.has(handler.type)) {
        throw new Error(`register: job type "${handler.type}" is already registered`);
      }
      if (!handler.persisted || handler.priority === 'interactive') {
        throw new Error(`register: "${handler.type}" must be a persisted background job type`);
      }
      handlers.set(handler.type, registeredHandler(handler));
    },

    enqueue({ type, payload, deviceId, campaignId, turnId }) {
      assertOpen('enqueue');
      // Implements PRV-066: an unknown type or a payload that does not parse is a
      // programmer error, so it throws (CONV-041).
      const handler = handlers.get(type);
      if (handler === undefined) {
        throw new Error(`enqueue: no handler is registered for job type "${type}"`);
      }
      const bound = handler.bind(payload);
      if (!bound.ok) throw new Error(`enqueue: ${bound.error.message}`);
      const opened = campaigns.openCampaign(campaignId);
      if (!opened.ok) return err(opened.error);
      // Stored jobs go first, so a campaign's new job never overtakes its old ones.
      if (!takenBack.has(campaignId)) takeBack(campaignId, opened.value);
      const job: JobFields = {
        id: randomUUID(),
        type,
        priority: handler.priority,
        deviceId,
        campaignId,
        turnId,
        persisted: true,
        attempts: 0,
        lastError: null,
        createdAt: now(),
        work: bound.value.work,
        complete: null,
      };
      recorder.inserted(opened.value, job, bound.value.json);
      runner.add(job);
      return ok({ jobId: job.id });
    },

    cancel: runner.cancel,
    wait: runner.wait,
    runInteractive,

    async resume() {
      assertOpen('resume');
      for (const campaignId of await campaigns.listCampaigns()) {
        if (takenBack.has(campaignId)) continue;
        // PRV-062: a campaign that fails to open or migrate is logged and skipped.
        try {
          const opened = campaigns.openCampaign(campaignId);
          if (opened.ok) takeBack(campaignId, opened.value);
          else logger.warn({ campaignId, code: opened.error.code }, 'a campaign did not open');
        } catch (error) {
          logger.error({ campaignId, err: error }, 'a campaign did not open');
        }
      }
    },

    stop: runner.stop,
  };
}
