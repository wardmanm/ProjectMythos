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
