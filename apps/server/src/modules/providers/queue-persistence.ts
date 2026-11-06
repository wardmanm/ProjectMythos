// How the job queue's jobs are stored and announced. A background job is a row in its
// campaign's `jobs` table (PRV-062), and every status change is written there first and
// then published as `job.updated` (PRV-065). Payloads are parsed with their handler's
// schema on enqueue and again on resume (CONV-030), so a stored payload that no longer
// fits is caught before its handler sees it.
import {
  type AppError,
  err,
  type Job,
  type JobPriority,
  type JobStatusSchema,
  ok,
  type Result,
  type TimeSource,
  type WallTime,
} from '@mythos/contracts';
import { z } from 'zod';
import type { EventBus } from '../events';
import {
  type CampaignStore,
  type Database,
  insertJob,
  listUnfinishedJobs,
  type PersistedJob,
  updateJob,
} from '../storage';
import type { JobContext, JobHandler, QueueLogger } from './queue';

type JobStatus = z.infer<typeof JobStatusSchema>;
type JsonPayload = PersistedJob['payload'];

/** A handler's work for one parsed payload. */
export type BoundWork = {
  run(ctx: JobContext): Promise<Result<void, AppError>>;
  /** The handler's failure path for this payload, or null if it has none (PRV-063). */
  onFailed: ((error: AppError) => Promise<void>) | null;
};

/** A registered handler, its payload type hidden behind `bind`. */
export type RegisteredHandler = {
  priority: JobPriority;
  /** Parses a payload as JSON and with the handler's schema, and binds the handler to it. */
  bind(payload: unknown): Result<{ json: JsonPayload; work: BoundWork }, AppError>;
};

/** Wraps a handler so the queue can hold handlers of every payload type in one map. */
export function registeredHandler<P>(handler: JobHandler<P>): RegisteredHandler {
  return {
    priority: handler.priority,
    bind(payload) {
      const json = z.json().safeParse(payload);
      if (!json.success) {
        return err(payloadError(handler.type, 'is not JSON, so it could not be stored'));
      }
      const parsed = handler.payloadSchema.safeParse(json.data);
      if (!parsed.success) {
        return err(payloadError(handler.type, `does not fit: ${z.prettifyError(parsed.error)}`));
      }
      const value = parsed.data;
      const work: BoundWork = {
        run: (ctx) => handler.run(value, ctx),
        onFailed: failurePath(handler, value),
      };
      return ok({ json: json.data, work });
    },
  };
}

function failurePath<P>(handler: JobHandler<P>, payload: P): BoundWork['onFailed'] {
  if (handler.onFailed === undefined) return null;
  return (error) => handler.onFailed?.(payload, error) ?? Promise.resolve();
}

function payloadError(type: string, problem: string): AppError {
  return { code: 'internal_error', message: `The payload for job type "${type}" ${problem}.` };
}

/** A stored job read back on resume, bound to its handler, or the reason it can't be. */
export type StoredJob = { stored: PersistedJob; bound: Result<BoundWork, AppError> };

/**
 * The campaign's unfinished jobs (`queued` and `running`), in stored order, each bound to
 * its handler. A job whose type has no handler, or whose payload no longer parses, comes
 * back with the error to mark it `failed` with. Implements PRV-062.
 */
export function readStoredJobs(
  db: Database,
  handlers: ReadonlyMap<string, RegisteredHandler>,
): StoredJob[] {
  return listUnfinishedJobs(db).map((stored) => {
    const handler = handlers.get(stored.type);
    if (handler === undefined) {
      const message = `No handler is registered for job type "${stored.type}".`;
      return { stored, bound: err({ code: 'internal_error', message }) };
    }
    const bound = handler.bind(stored.payload);
    return { stored, bound: bound.ok ? ok(bound.value.work) : bound };
  });
}

/** The fields of a job that its stored row and its `job.updated` record need. */
export type RecordedJob = Omit<Job, 'status' | 'updatedAt'> & {
  /** Null only for an interactive job outside a campaign (PRV-092). */
  campaignId: string | null;
  persisted: boolean;
  lastError: AppError | null;
};

export type JobRecorderOptions = {
  campaigns: Pick<CampaignStore, 'openCampaign'>;
  publish: EventBus['publish'];
  timeSource: TimeSource;
  logger: QueueLogger;
};

/** Writes each job change to storage first and then publishes it (PRV-062, PRV-065). */
export type JobRecorder = {
  /** Stores a new background job in its campaign's database, then publishes it. */
  inserted(db: Database, job: RecordedJob, payload: JsonPayload): void;
  /** Stores a job's new status, if it is persisted, then publishes it, if it has a campaign. */
  changed(job: RecordedJob, status: JobStatus): void;
};

/** Builds the recorder. It opens campaigns through the store each time, holding none. */
export function createJobRecorder(options: JobRecorderOptions): JobRecorder {
  const { campaigns, publish, timeSource, logger } = options;
  const now = (): WallTime => new Date(timeSource.now()).toISOString();

  function announce(job: RecordedJob, status: JobStatus, updatedAt: WallTime): void {
    // Implements PRV-065. A job without a campaign (the probe, PRV-092) has no stream.
    if (job.campaignId === null) return;
    publish(job.campaignId, { type: 'job.updated', job: jobRecord(job, status, updatedAt) });
  }

  function store(job: RecordedJob & { campaignId: string }, status: JobStatus, at: WallTime) {
    const update = { status, attempts: job.attempts, lastError: job.lastError, updatedAt: at };
    const fields = { jobId: job.id, campaignId: job.campaignId, status };
    // A change that cannot be stored is logged, and the queue goes on in memory: one
    // campaign's missing or broken database must not stop every other campaign's jobs.
    try {
      const opened = campaigns.openCampaign(job.campaignId);
      if (opened.ok) updateJob(opened.value, job.id, update);
      else logger.warn({ ...fields, code: opened.error.code }, 'a job change was not stored');
    } catch (error) {
      logger.error({ ...fields, error }, 'a job change was not stored');
    }
  }

  return {
    inserted(db, job, payload) {
      const createdAt = job.createdAt;
      insertJob(db, { ...jobRecord(job, 'queued', createdAt), payload, lastError: job.lastError });
      announce(job, 'queued', createdAt);
    },

    changed(job, status) {
      const updatedAt = now();
      const { campaignId } = job;
      if (job.persisted && campaignId !== null) store({ ...job, campaignId }, status, updatedAt);
      announce(job, status, updatedAt);
    },
  };
}

/** A stored job of `campaignId` as the queue keeps it: its record, without the row's status. */
export function fromStored(stored: PersistedJob, campaignId: string): RecordedJob {
  return {
    id: stored.id,
    type: stored.type,
    priority: stored.priority,
    deviceId: stored.deviceId,
    attempts: stored.attempts,
    turnId: stored.turnId,
    createdAt: stored.createdAt,
    campaignId,
    persisted: true,
    lastError: stored.lastError,
  };
}

/** The queue-visible record of a job (03-contracts §11), as `job.updated` carries it. */
export function jobRecord(job: RecordedJob, status: JobStatus, updatedAt: WallTime): Job {
  return {
    id: job.id,
    type: job.type,
    priority: job.priority,
    deviceId: job.deviceId,
    status,
    attempts: job.attempts,
    turnId: job.turnId,
    createdAt: job.createdAt,
    updatedAt,
  };
}
