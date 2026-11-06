// The job queue's decisions, as pure functions: the settings machine config gives it,
// the order jobs run in, which job to preempt, and when and whether to retry. The queue
// in queue.ts does the IO and keeps the state; nothing here reads a clock or a file.
import {
  type AppError,
  DeviceSchema,
  type JobPriority,
  JobPrioritySchema,
  MachineConfigSchema,
  type MachineConfig,
  type Result,
} from '@mythos/contracts';
import { z } from 'zod';

/** What one scheduling decision reads from machine config (PRV-004). */
export type QueueSettings = {
  preemptBackground: boolean;
  maxAttempts: number;
  /** How many jobs the device runs at once. */
  concurrency(deviceId: string): number;
};

// The schema's own defaults, so they are written in one place (05-providers §2).
const defaultQueue = MachineConfigSchema.shape.queue.parse(undefined);
const defaultConcurrency = DeviceSchema.shape.concurrency.parse(undefined);

/**
 * The queue settings from the config in effect. A device missing from it runs at the
 * schema's default concurrency, 1, and so does every device while the config fails to
 * load (05-providers Decisions). Implements PRV-004 and ARCH-081.
 */
export function queueSettings(config: Result<MachineConfig, AppError>): QueueSettings {
  if (!config.ok) {
    return { ...defaultQueue, concurrency: () => defaultConcurrency };
  }
  const { devices, queue } = config.value;
  return {
    preemptBackground: queue.preemptBackground,
    maxAttempts: queue.maxAttempts,
    concurrency: (deviceId) =>
      devices.find((device) => device.id === deviceId)?.concurrency ?? defaultConcurrency,
  };
}

/** A job as scheduling sees it. */
export type SlotJob = {
  deviceId: string;
  priority: JobPriority;
  status: 'queued' | 'running';
  /** The order jobs arrived in, from 1. A retried or preempted job keeps its number. */
  arrival: number;
  /** The order runs started in, from 1; 0 before the first. */
  started: number;
  /** True while a queued job waits for its backoff timer. */
  waitingToRetry: boolean;
  /** True while a running job's signal is aborted and its run has not yet settled. */
  stopping: boolean;
};

/** 0 for `interactive`, the highest priority, and so on down (ARCH-080). */
export function priorityRank(priority: JobPriority): number {
  return JobPrioritySchema.options.indexOf(priority);
}

/** Highest priority first, then oldest first within a priority (PRV-060). */
function byPriorityThenArrival(a: SlotJob, b: SlotJob): number {
  return priorityRank(a.priority) - priorityRank(b.priority) || a.arrival - b.arrival;
}

/** What one scheduling pass does: the runs to start and the runs to preempt. */
export type PassPlan<J extends SlotJob> = { start: J[]; preempt: J[] };

/**
 * Plans one pass over every device. Each fills its free slots with its ready jobs in
 * priority order (PRV-060). A device with no free slot, a ready interactive job, and
 * only background jobs running, none already stopping, preempts the one started last
 * (PRV-064). A slot frees only when its run settles, so a device never runs more than
 * its concurrency. Implements ARCH-080, ARCH-081, PRV-060, and PRV-064.
 */
export function planPass<J extends SlotJob>(
  jobs: readonly J[],
  settings: QueueSettings,
): PassPlan<J> {
  const plan: PassPlan<J> = { start: [], preempt: [] };
  for (const deviceId of new Set(jobs.map((job) => job.deviceId))) {
    const onDevice = jobs.filter((job) => job.deviceId === deviceId);
    const running = onDevice.filter((job) => job.status === 'running');
    const ready = onDevice
      .filter((job) => job.status === 'queued' && !job.waitingToRetry)
      .sort(byPriorityThenArrival);
    const free = settings.concurrency(deviceId) - running.length;
    if (free > 0) {
      plan.start.push(...ready.slice(0, free));
      continue;
    }
    const victim = preemptionVictim(ready, running, settings);
    if (victim !== null) plan.preempt.push(victim);
  }
  return plan;
}

function preemptionVictim<J extends SlotJob>(
  ready: readonly J[],
  running: readonly J[],
  settings: QueueSettings,
): J | null {
  if (!settings.preemptBackground || ready[0]?.priority !== 'interactive') return null;
  if (!running.every((job) => job.priority !== 'interactive' && !job.stopping)) return null;
  let latest: J | null = null;
  for (const job of running) if (latest === null || job.started > latest.started) latest = job;
  return latest;
}

// PRV-013: adapters mark transient errors `retryable: true`, and put a provider's
// `retry-after` on `rate_limited` errors as `details.retryAfterSeconds`.
const RetryableSchema = z.object({ retryable: z.literal(true) });
const RetryAfterSchema = z.object({ retryAfterSeconds: z.number().nonnegative() });

/**
 * Whether the queue retries an error: only when it carries `retryable: true`, as a
 * `ProviderError` does (05-providers Decisions). Implements PRV-051 and PRV-063.
 */
export function isRetryable(error: AppError): boolean {
  return RetryableSchema.safeParse(error).success;
}

export const FIRST_BACKOFF_MS = 2000;
export const BACKOFF_FACTOR = 4;
export const MAX_BACKOFF_MS = 30_000;

/**
 * How long a job waits before its next attempt, after `failures` runs that failed:
 * 2 s, 8 s, then 30 s each time, or the error's `retryAfterSeconds` when that is
 * longer. Implements PRV-063.
 */
export function backoffMs(failures: number, error: AppError): number {
  const exponential = Math.min(
    FIRST_BACKOFF_MS * BACKOFF_FACTOR ** Math.max(failures - 1, 0),
    MAX_BACKOFF_MS,
  );
  const retryAfter = RetryAfterSchema.safeParse(error.details);
  if (!retryAfter.success) return exponential;
  return Math.max(exponential, retryAfter.data.retryAfterSeconds * 1000);
}
