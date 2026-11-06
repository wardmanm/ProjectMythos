// Branches and the branch_turns projection. A branch is mutable state, not a commit
// (TRN-002); branch_turns lists every turn in each branch's ancestry (TRN-003) and is
// written only here, in turns.ts, and in rebuild.ts (ARCH-040).
import type { Branch } from '@mythos/contracts';
import { BranchRowSchema, parseRow } from './rows';
import type { Database } from './sqlite';

const BRANCH_COLUMNS = 'id, name, head_turn_id, forked_from_turn_id, archived, created_at';

/**
 * Adds a `branch_turns` row for every turn in `headTurnId`'s ancestry, found by walking
 * parent links back to the root. Used by fork and by the rebuild (TRN-003, ARCH-042).
 */
export function insertAncestry(db: Database, branchId: string, headTurnId: string): void {
  db.prepare(
    `WITH RECURSIVE ancestry (id, parent_turn_id, depth) AS (
       SELECT id, parent_turn_id, depth FROM turns WHERE id = :headTurnId
       UNION ALL
       SELECT turns.id, turns.parent_turn_id, turns.depth
       FROM turns JOIN ancestry ON turns.id = ancestry.parent_turn_id
     )
     INSERT INTO branch_turns (branch_id, turn_id, depth)
     SELECT :branchId, id, depth FROM ancestry`,
  ).run({ branchId, headTurnId });
}

/** Adds the one `branch_turns` row for a turn just added at a branch's head (TRN-003). */
export function addBranchTurn(db: Database, branchId: string, turnId: string, depth: number): void {
  db.prepare(
    'INSERT INTO branch_turns (branch_id, turn_id, depth) VALUES (:branchId, :turnId, :depth)',
  ).run({ branchId, turnId, depth });
}

/** Removes a turn's `branch_turns` row when it leaves the branch's head (TRN-003, TRN-047). */
export function removeBranchTurn(db: Database, branchId: string, turnId: string): void {
  const { changes } = db
    .prepare('DELETE FROM branch_turns WHERE branch_id = :branchId AND turn_id = :turnId')
    .run({ branchId, turnId });
  if (changes !== 1) {
    throw new Error(`removeBranchTurn: turn ${turnId} is not on branch ${branchId}`);
  }
}

/** Points a branch at a new head. The caller keeps `branch_turns` in step. */
export function setBranchHead(db: Database, branchId: string, headTurnId: string): void {
  const { changes } = db
    .prepare('UPDATE branches SET head_turn_id = :headTurnId WHERE id = :branchId')
    .run({ branchId, headTurnId });
  if (changes !== 1) throw new Error(`setBranchHead: no branch ${branchId}`);
}

/** Inserts the branch row only; `createBranch` and `insertRootTurn` add its turns. */
export function insertBranchRow(db: Database, branch: Branch): void {
  db.prepare(
    `INSERT INTO branches (${BRANCH_COLUMNS}, seq)
     VALUES (:id, :name, :headTurnId, :forkedFromTurnId, :archived, :createdAt,
             (SELECT COALESCE(MAX(seq), -1) + 1 FROM branches))`,
  ).run({
    id: branch.id,
    name: branch.name,
    headTurnId: branch.headTurnId,
    forkedFromTurnId: branch.forkedFromTurnId,
    archived: branch.archived ? 1 : 0,
    createdAt: branch.createdAt,
  });
}

/**
 * Creates a branch whose head is an existing turn, with the `branch_turns` rows of
 * that turn's ancestry, in one transaction. No turns are copied, and nothing is
 * committed: a branch is not part of the event log (TRN-002, TRN-100).
 */
export function createBranch(db: Database, branch: Branch): void {
  db.transaction(() => {
    insertBranchRow(db, branch);
    insertAncestry(db, branch.id, branch.headTurnId);
  });
}

/** One branch, or null if there is none with that ID. */
export function readBranch(db: Database, branchId: string): Branch | null {
  const row = db.prepare(`SELECT ${BRANCH_COLUMNS} FROM branches WHERE id = :branchId`).get({
    branchId,
  });
  return row === undefined ? null : parseRow('branches', BranchRowSchema, row, ['id']);
}

/** Every branch, archived ones included, in creation order. */
export function listBranches(db: Database): Branch[] {
  return db
    .prepare(`SELECT ${BRANCH_COLUMNS} FROM branches ORDER BY seq`)
    .all()
    .map((row) => parseRow('branches', BranchRowSchema, row, ['id']));
}
