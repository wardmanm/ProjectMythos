// The event log's write path: turns, commit sets, and commits (06-turn-engine §2).
// They are append-only (TRN-001); the only updates are `turns.status` and
// `commit_sets.active`, which follows supersession in the same transaction. Each
// public write here is one transaction (ARCH-041).
import type { Branch, Commit, CommitPayload, CommitSet, Turn, TurnStatus } from '@mythos/contracts';
import { z } from 'zod';
import { addBranchTurn, insertBranchRow, readBranch, setBranchHead } from './branches';
import {
  COMMIT_SET_SCHEMA_VERSION,
  CountRowSchema,
  parseRow,
  SeqRowSchema,
  sqliteBoolean,
  TurnRowSchema,
} from './rows';
import type { Database } from './sqlite';

/** A commit to write. Its `seq` is its position in the set, and its `setId` the set's. */
export type NewCommit = Pick<Commit, 'id' | 'payload'>;

/** A commit set to write. Storage assigns its `seq` (CON-084). */
export type NewCommitSet = { set: Omit<CommitSet, 'seq'>; commits: readonly NewCommit[] };

const TURN_COLUMNS =
  'id, parent_turn_id, depth, status, game_time_start, copied_from_turn_id, created_at';

function insertTurnRow(db: Database, turn: Turn): void {
  db.prepare(
    `INSERT INTO turns (${TURN_COLUMNS})
     VALUES (:id, :parentTurnId, :depth, :status, :gameTimeStart, :copiedFromTurnId, :createdAt)`,
  ).run({
    id: turn.id,
    parentTurnId: turn.parentTurnId,
    depth: turn.depth,
    status: turn.status,
    gameTimeStart: turn.gameTimeStart,
    copiedFromTurnId: turn.copiedFromTurnId,
    createdAt: turn.createdAt,
  });
}

const SupersededRowSchema = z.object({ turn_id: z.string(), active: sqliteBoolean });

// A set may supersede only the active set it replaces, on its own turn (CON-081).
function checkSupersedes(db: Database, set: NewCommitSet['set'], supersededId: string): void {
  const row = db
    .prepare('SELECT turn_id, active FROM commit_sets WHERE id = :id')
    .get({ id: supersededId });
  if (row === undefined) throw new Error(`set ${set.id} supersedes unknown set ${supersededId}`);
  const superseded = parseRow('commit_sets', SupersededRowSchema, row, ['turn_id']);
  if (superseded.turn_id !== set.turnId) {
    throw new Error(`set ${set.id} supersedes set ${supersededId}, which is on another turn`);
  }
  if (!superseded.active) {
    throw new Error(`set ${set.id} supersedes set ${supersededId}, which is already superseded`);
  }
}

function insertCommit(db: Database, setId: string, seq: number, commit: NewCommit): void {
  db.prepare(
    'INSERT INTO commits (id, set_id, seq, type, payload) VALUES (:id, :setId, :seq, :type, :payload)',
  ).run({
    id: commit.id,
    setId,
    seq,
    type: commit.payload.type,
    payload: JSON.stringify(commit.payload satisfies CommitPayload),
  });
}

// Writes one set and its commits. Must run inside a transaction.
function insertSet(db: Database, { set, commits }: NewCommitSet): CommitSet {
  if (set.schemaVersion !== COMMIT_SET_SCHEMA_VERSION) {
    throw new Error(`set ${set.id}: schemaVersion must be ${String(COMMIT_SET_SCHEMA_VERSION)}`);
  }
  if (set.supersedesSetId !== null) checkSupersedes(db, set, set.supersedesSetId);
  // Implements CON-084: seq is the campaign-wide creation order, assigned here.
  const row = db
    .prepare(
      `INSERT INTO commit_sets (id, turn_id, stage, origin, supersedes_set_id, based_on_set_ids,
         copied_from_set_id, schema_version, seq, created_at, active)
       VALUES (:id, :turnId, :stage, :origin, :supersedesSetId, :basedOnSetIds,
         :copiedFromSetId, :schemaVersion, (SELECT COALESCE(MAX(seq), -1) + 1 FROM commit_sets),
         :createdAt, 1)
       RETURNING seq`,
    )
    .get({
      id: set.id,
      turnId: set.turnId,
      stage: set.stage,
      origin: set.origin,
      supersedesSetId: set.supersedesSetId,
      basedOnSetIds: JSON.stringify(set.basedOnSetIds),
      copiedFromSetId: set.copiedFromSetId,
      schemaVersion: set.schemaVersion,
      createdAt: set.createdAt,
    });
  const { seq } = parseRow('commit_sets', SeqRowSchema, row, ['seq']);
  commits.forEach((commit, index) => {
    insertCommit(db, set.id, index, commit);
  });
  if (set.supersedesSetId !== null) {
    // Implements TRN-001: `active` follows supersession, in the same transaction.
    db.prepare('UPDATE commit_sets SET active = 0 WHERE id = :id').run({ id: set.supersedesSetId });
  }
  return { ...set, seq };
}

function insertSets(db: Database, turnId: string, sets: readonly NewCommitSet[]): CommitSet[] {
  return sets.map((newSet) => {
    if (newSet.set.turnId !== turnId) {
      throw new Error(`set ${newSet.set.id} belongs to turn ${newSet.set.turnId}, not ${turnId}`);
    }
    return insertSet(db, newSet);
  });
}

/**
 * Writes a campaign's first turn with its sets, and the first branch pointing at it,
 * in one transaction. Throws if the campaign already has a root turn.
 */
export function insertRootTurn(
  db: Database,
  input: { branch: Branch; turn: Turn; sets: readonly NewCommitSet[] },
): CommitSet[] {
  const { branch, turn } = input;
  if (turn.parentTurnId !== null || turn.depth !== 0) {
    throw new Error(`insertRootTurn: turn ${turn.id} has a parent or a depth above 0`);
  }
  if (branch.headTurnId !== turn.id) {
    throw new Error(`insertRootTurn: branch ${branch.id} must point at turn ${turn.id}`);
  }
  return db.transaction(() => {
    const roots = db.prepare('SELECT COUNT(*) AS count FROM turns WHERE parent_turn_id IS NULL');
    if (parseRow('turns', CountRowSchema, roots.get(), []).count > 0) {
      throw new Error('insertRootTurn: the campaign already has a root turn');
    }
    insertTurnRow(db, turn);
    const sets = insertSets(db, turn.id, input.sets);
    insertBranchRow(db, branch);
    addBranchTurn(db, branch.id, turn.id, 0);
    return sets;
  });
}

/**
 * Adds a turn as a child of a branch's head: the turn, its sets and their commits, the
 * new head, and its `branch_turns` row, all in one transaction, so a submitted input
 * is never lost to a crash (TRN-011, ARCH-041). Returns the sets with their `seq`.
 * The caller has checked the head it expected (TRN-120); a mismatch here throws.
 */
export function insertTurn(
  db: Database,
  input: { branchId: string; turn: Turn; sets: readonly NewCommitSet[] },
): CommitSet[] {
  const { turn } = input;
  return db.transaction(() => {
    const branch = readBranch(db, input.branchId);
    if (branch === null) throw new Error(`insertTurn: no branch ${input.branchId}`);
    const parent = readTurn(db, branch.headTurnId);
    if (parent === null || turn.parentTurnId !== parent.id) {
      throw new Error(`insertTurn: turn ${turn.id}'s parent is not branch ${branch.id}'s head`);
    }
    if (turn.depth !== parent.depth + 1) {
      throw new Error(`insertTurn: turn ${turn.id} must have depth ${String(parent.depth + 1)}`);
    }
    insertTurnRow(db, turn);
    const sets = insertSets(db, turn.id, input.sets);
    setBranchHead(db, branch.id, turn.id);
    // Implements TRN-003: one turn added, one branch_turns row.
    addBranchTurn(db, branch.id, turn.id, turn.depth);
    return sets;
  });
}

/**
 * Adds a set and its commits to an existing turn, in one transaction. A set with
 * `supersedesSetId` makes that set inactive (CON-081, TRN-001). Returns it with its
 * `seq`.
 */
export function appendSet(db: Database, newSet: NewCommitSet): CommitSet {
  return db.transaction(() => {
    if (readTurn(db, newSet.set.turnId) === null) {
      throw new Error(`appendSet: no turn ${newSet.set.turnId}`);
    }
    return insertSet(db, newSet);
  });
}

/** Sets a turn's pipeline status, the one mutable column of `turns` (TRN-001, TRN-010). */
export function setTurnStatus(db: Database, turnId: string, status: TurnStatus): void {
  const { changes } = db
    .prepare('UPDATE turns SET status = :status WHERE id = :turnId')
    .run({ turnId, status });
  if (changes !== 1) throw new Error(`setTurnStatus: no turn ${turnId}`);
}

/** One turn, or null if there is none with that ID. */
export function readTurn(db: Database, turnId: string): Turn | null {
  const row = db.prepare(`SELECT ${TURN_COLUMNS} FROM turns WHERE id = :turnId`).get({ turnId });
  return row === undefined ? null : parseRow('turns', TurnRowSchema, row, ['id']);
}

/**
 * Up to `limit` turns on a branch with depth below `beforeDepth` (null: up to and
 * including the head), the latest ones, in depth order. Pages back through history.
 */
export function readTurnsOnBranch(
  db: Database,
  branchId: string,
  beforeDepth: number | null,
  limit: number,
): Turn[] {
  const rows = db
    .prepare(
      `SELECT turns.id, turns.parent_turn_id, turns.depth, turns.status, turns.game_time_start,
         turns.copied_from_turn_id, turns.created_at
       FROM branch_turns JOIN turns ON turns.id = branch_turns.turn_id
       WHERE branch_turns.branch_id = :branchId
         AND (:beforeDepth IS NULL OR branch_turns.depth < :beforeDepth)
       ORDER BY branch_turns.depth DESC
       LIMIT :limit`,
    )
    .all({ branchId, beforeDepth, limit });
  return rows.map((row) => parseRow('turns', TurnRowSchema, row, ['id'])).reverse();
}
