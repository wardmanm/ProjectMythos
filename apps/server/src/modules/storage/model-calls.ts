// Model call records (ARCH-060): stored in the campaign, but not commits, and pruned
// by the retention setting (ARCH-061). `created_at` is INTEGER milliseconds so the
// prune compares numbers, not WallTime strings.
import type { ModelCallRecord, WallTime } from '@mythos/contracts';
import { ModelCallRowSchema, parseRow } from './rows';
import type { Database } from './sqlite';

/** Stores one record. Its `seq` keeps records in the order they were written (CONV-054). */
export function insertModelCall(db: Database, record: ModelCallRecord): void {
  db.prepare(
    `INSERT INTO model_calls (id, seq, turn_id, created_at, record)
     VALUES (:id, (SELECT COALESCE(MAX(seq), -1) + 1 FROM model_calls), :turnId, :createdAt,
             :record)`,
  ).run({
    id: record.id,
    turnId: record.turnId,
    createdAt: Date.parse(record.createdAt),
    record: JSON.stringify(record),
  });
}

/** A turn's records, oldest first. */
export function listModelCalls(db: Database, turnId: string): ModelCallRecord[] {
  return db
    .prepare('SELECT id, record FROM model_calls WHERE turn_id = :turnId ORDER BY seq')
    .all({ turnId })
    .map((row) => parseRow('model_calls', ModelCallRowSchema, row, ['id']));
}

/** One record, or null if there is none with that ID (or it was pruned). */
export function readModelCall(db: Database, callId: string): ModelCallRecord | null {
  const row = db.prepare('SELECT id, record FROM model_calls WHERE id = :callId').get({ callId });
  return row === undefined ? null : parseRow('model_calls', ModelCallRowSchema, row, ['id']);
}

/** Deletes every record made before `olderThan` and returns how many. Implements ARCH-061. */
export function pruneModelCalls(db: Database, olderThan: WallTime): number {
  return db
    .prepare('DELETE FROM model_calls WHERE created_at < :olderThan')
    .run({ olderThan: Date.parse(olderThan) }).changes;
}
