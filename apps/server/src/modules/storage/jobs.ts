// Persisted background jobs (PRV-062): kept in the campaign so they resume when it
// opens again. Interactive jobs are never stored (PRV-061).
import type { AppError, JobStatusSchema, WallTime } from '@mythos/contracts';
import type { z } from 'zod';
import { JobRowSchema, parseRow, type PersistedJob } from './rows';
import type { Database } from './sqlite';

type JobStatus = z.infer<typeof JobStatusSchema>;

const JOB_COLUMNS =
  'id, type, priority, device_id, turn_id, status, attempts, payload, last_error, created_at, updated_at';

/** Stores a new job. Its `seq` keeps jobs in the order they were queued (CONV-054). */
export function insertJob(db: Database, job: PersistedJob): void {
  db.prepare(
    `INSERT INTO jobs (${JOB_COLUMNS}, seq)
     VALUES (:id, :type, :priority, :deviceId, :turnId, :status, :attempts, :payload,
             :lastError, :createdAt, :updatedAt, (SELECT COALESCE(MAX(seq), -1) + 1 FROM jobs))`,
  ).run({
    id: job.id,
    type: job.type,
    priority: job.priority,
    deviceId: job.deviceId,
    turnId: job.turnId,
    status: job.status,
    attempts: job.attempts,
    payload: JSON.stringify(job.payload),
    lastError: job.lastError === null ? null : JSON.stringify(job.lastError),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

/** Records a job's progress: its status, attempts, last error, and when it changed. */
export function updateJob(
  db: Database,
  jobId: string,
  update: { status: JobStatus; attempts: number; lastError: AppError | null; updatedAt: WallTime },
): void {
  const { changes } = db
    .prepare(
      `UPDATE jobs SET status = :status, attempts = :attempts, last_error = :lastError,
         updated_at = :updatedAt
       WHERE id = :jobId`,
    )
    .run({
      jobId,
      status: update.status,
      attempts: update.attempts,
      lastError: update.lastError === null ? null : JSON.stringify(update.lastError),
      updatedAt: update.updatedAt,
    });
  if (changes !== 1) throw new Error(`updateJob: no job ${jobId}`);
}

/**
 * Jobs still `queued` or `running`, in the order they were queued, for the queue to
 * take back when the campaign opens (PRV-062). A `running` job was cut off by a stop.
 */
export function listUnfinishedJobs(db: Database): PersistedJob[] {
  return db
    .prepare(`SELECT ${JOB_COLUMNS} FROM jobs WHERE status IN ('queued', 'running') ORDER BY seq`)
    .all()
    .map((row) => parseRow('jobs', JobRowSchema, row, ['id']));
}
