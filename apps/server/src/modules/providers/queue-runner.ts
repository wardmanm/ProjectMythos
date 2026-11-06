// Running the job queue's jobs in their device slots: the scheduling pass, each run, and
// what follows it (success, a retry after a backoff, failure, preemption, cancellation).
// queue.ts adds the jobs; the decisions themselves are pure functions in queue-policy.ts.
//
// Scheduling is event-driven: every change (a job added, a run settling, a backoff timer,
// a cancel) asks for one scheduling pass, which runs in a microtask. Changes in the same
// tick share a pass, a handler never runs inside its caller's `enqueue`, and a pass never
// runs inside another.
import { type AppError, err, ok, type Result } from '@mythos/contracts';
import type { ConfigStore } from '../config';
import type { JobContext, QueueLogger, SetTimer } from './queue';
import type { BoundWork, JobRecorder, RecordedJob } from './queue-persistence';
import { backoffMs, isRetryable, planPass, queueSettings } from './queue-policy';

/** What a job is made from: its record, its work, and, if interactive, its caller. */
export type JobFields = RecordedJob & {
  readonly work: BoundWork;
  /** Resolves `runInteractive`'s result; null for a background job. */
  readonly complete: ((final: Result<void, AppError> | null) => void) | null;
};

/** Why a running job's signal was aborted. A cancel overrides the other two. */
type StopReason = 'preempted' | 'stopped' | 'cancelled';
type Ending = 'succeeded' | 'failed' | 'cancelled';

/** A job the queue holds: queued (perhaps waiting to retry) or running. */
type LiveJob = JobFields & {
  readonly arrival: number;
  status: 'queued' | 'running';
  started: number;
  stopReason: StopReason | null;
  controller: AbortController | null;
  /** Set while the job waits for its backoff timer. */
  clearTimer: (() => void) | null;
  waiters: ((outcome: Result<void, AppError>) => void)[];
};

export type QueueRunnerOptions = {
  config: Pick<ConfigStore, 'current'>;
  recorder: JobRecorder;
  setTimer: SetTimer;
  logger: QueueLogger;
};

// Function-valued properties, not methods, so queue.ts can hand them on as they are.
export type QueueRunner = {
  /** Adds a job that is already stored and published as queued, last in arrival order. */
  add: (fields: JobFields) => void;
  /** Ends a queued job at once, or aborts a running one, which ends when its run settles. */
  cancel: (jobId: string) => void;
  /** Resolves when the job ends; `not_found` for one the queue does not hold. */
  wait: (jobId: string) => Promise<Result<void, AppError>>;
  /** True once `stop` has been called. */
  isStopped: () => boolean;
  /** Stops for shutdown, and resolves once every run in flight has settled. */
  stop: () => Promise<void>;
};

export function cancelledError(jobId: string): AppError {
  return { code: 'cancelled', message: `Job ${jobId} was cancelled.` };
}

function stoppedError(jobId: string): AppError {
  const message = `The job queue stopped before job ${jobId} finished; it resumes at the next start.`;
  return { code: 'cancelled', message };
}

/** Builds the runner that `createJobQueue` drives. Implements PRV-060 and PRV-063 to PRV-065. */
export function createQueueRunner(options: QueueRunnerOptions): QueueRunner {
  const { config, recorder, setTimer, logger } = options;
  // Queued and running jobs only: the queue forgets a job once it finishes.
  const jobs = new Map<string, LiveJob>();
  const runs = new Set<Promise<void>>();
  let arrivals = 0;
  let starts = 0;
  let passScheduled = false;
  let stopped = false;

  function schedulePass(): void {
    if (passScheduled || stopped) return;
    passScheduled = true;
    queueMicrotask(runPass);
  }

  /** One scheduling decision for every device, with machine config read once (PRV-004). */
  function runPass(): void {
    passScheduled = false;
    if (stopped) return;
    const slots = [...jobs.values()].map((job) => ({
      job,
      deviceId: job.deviceId,
      priority: job.priority,
      status: job.status,
      arrival: job.arrival,
      started: job.started,
      waitingToRetry: job.clearTimer !== null,
      stopping: job.stopReason !== null,
    }));
    const plan = planPass(slots, queueSettings(config.current()));
    for (const { job } of plan.preempt) stopRun(job, 'preempted');
    for (const { job } of plan.start) start(job);
  }

  function start(job: LiveJob): void {
    starts += 1;
    const controller = new AbortController();
    job.status = 'running';
    job.started = starts;
    job.controller = controller;
    recorder.changed(job, 'running');
    const ctx: JobContext = { jobId: job.id, attempt: job.attempts + 1, signal: controller.signal };
    const run = execute(job, ctx).finally(() => runs.delete(run));
    runs.add(run);
  }

  async function execute(job: LiveJob, ctx: JobContext): Promise<void> {
    let result: Result<void, AppError>;
    try {
      result = await job.work.run(ctx);
    } catch (error) {
      // CONV-041: a throw is caught once, here, logged, and fails the job.
      logger.error({ jobId: job.id, type: job.type, err: error }, 'a job threw');
      result = err({ code: 'internal_error', message: `Job ${job.id} failed unexpectedly.` });
    }
    try {
      settle(job, result);
    } catch (error) {
      // Only a defect in the queue throws here. It is logged rather than left to reject
      // a promise nobody awaits, which would stop the server.
      logger.error({ jobId: job.id, type: job.type, err: error }, 'a job did not settle');
    }
  }

  /** Aborts a running job's signal. Its slot frees only when its run settles (PRV-064). */
  function stopRun(job: LiveJob, reason: StopReason): void {
    if (job.stopReason !== 'cancelled') job.stopReason = reason;
    job.controller?.abort();
  }

  /** What follows a run (05-providers Decisions on attempts and cancelling). */
  function settle(job: LiveJob, result: Result<void, AppError>): void {
    const reason = job.stopReason;
    job.stopReason = null;
    job.controller = null;
    if (reason === 'cancelled') {
      finish(job, 'cancelled', result);
    } else if (result.ok) {
      // A preempted or stopped run that still returns ok has done its work.
      job.attempts += 1;
      finish(job, 'succeeded', result);
    } else if (reason === 'preempted') {
      // Implements PRV-064: back in its old place, without counting an attempt.
      job.status = 'queued';
      recorder.changed(job, 'queued');
      schedulePass();
    } else if (reason === 'stopped') {
      // Stored as queued, so it runs again at the next start (ARCH-082).
      jobs.delete(job.id);
      recorder.changed(job, 'queued');
      resolveWaiters(job, err(stoppedError(job.id)));
    } else {
      job.attempts += 1;
      job.lastError = result.error;
      retryOrFail(job, result.error);
    }
  }

  /** After a failed run: retried after a backoff, or the job fails (PRV-051, PRV-063). */
  function retryOrFail(job: LiveJob, error: AppError): void {
    const { maxAttempts } = queueSettings(config.current());
    if (!isRetryable(error) || job.attempts >= maxAttempts) {
      finish(job, 'failed', err(error));
      return;
    }
    job.status = 'queued';
    recorder.changed(job, 'queued');
    job.clearTimer = setTimer(backoffMs(job.attempts, error), () => {
      job.clearTimer = null;
      schedulePass();
    });
    schedulePass();
  }

  /** Ends a job: stores and publishes its last status, then tells whoever is waiting. */
  function finish(job: LiveJob, ending: Ending, final: Result<void, AppError> | null): void {
    job.clearTimer?.();
    job.clearTimer = null;
    jobs.delete(job.id);
    recorder.changed(job, ending);
    if (ending === 'succeeded') resolveWaiters(job, ok(undefined));
    else if (ending === 'failed' && job.lastError !== null) resolveWaiters(job, err(job.lastError));
    else resolveWaiters(job, err(cancelledError(job.id)));
    job.complete?.(final);
    if (ending === 'failed') runFailurePath(job);
    schedulePass();
  }

  function resolveWaiters(job: LiveJob, outcome: Result<void, AppError>): void {
    for (const resolve of job.waiters.splice(0)) resolve(outcome);
  }

  /** Runs the handler's `onFailed`, after the job is stored as failed (PRV-063). */
  function runFailurePath(job: LiveJob): void {
    const { onFailed } = job.work;
    const error = job.lastError;
    if (onFailed === null || error === null) return;
    // Nothing awaits the failure path, so a failure inside it is logged here (CONV-043).
    void Promise.resolve()
      .then(() => onFailed(error))
      .catch((failure: unknown) => {
        logger.error({ jobId: job.id, type: job.type, err: failure }, 'onFailed threw');
      });
  }

  return {
    add(fields) {
      arrivals += 1;
      const job: LiveJob = {
        ...fields,
        arrival: arrivals,
        status: 'queued',
        started: 0,
        stopReason: null,
        controller: null,
        clearTimer: null,
        waiters: [],
      };
      jobs.set(job.id, job);
      schedulePass();
    },

    cancel(jobId) {
      // Implements ARCH-083.
      const job = jobs.get(jobId);
      if (job === undefined) return;
      if (job.status === 'running') stopRun(job, 'cancelled');
      else finish(job, 'cancelled', null);
    },

    wait(jobId) {
      const job = jobs.get(jobId);
      if (job === undefined) {
        const message = `No job ${jobId} is queued or running.`;
        return Promise.resolve(err({ code: 'not_found', message }));
      }
      return new Promise((resolve) => {
        job.waiters.push(resolve);
      });
    },

    isStopped: () => stopped,

    async stop() {
      stopped = true;
      for (const job of [...jobs.values()]) {
        if (job.status === 'running') {
          stopRun(job, job.persisted ? 'stopped' : 'cancelled');
        } else if (job.persisted) {
          // Already stored as queued, so it resumes at the next start.
          job.clearTimer?.();
          jobs.delete(job.id);
          resolveWaiters(job, err(stoppedError(job.id)));
        } else {
          finish(job, 'cancelled', null);
        }
      }
      await Promise.all(runs);
    },
  };
}
