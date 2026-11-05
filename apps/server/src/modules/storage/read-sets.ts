// The sets one read point needs (TRN-060, TRN-061), for folding in core.
import { type Commit, type CommitSet, CommitStageSchema, type ReadPoint } from '@mythos/contracts';
import { z } from 'zod';
import { CommitRowSchema, CommitSetRowSchema, parseRow } from './rows';
import type { Database } from './sqlite';

/** An active set with its commits in `seq` order, and its turn's depth on the branch. */
export type SetForRead = { set: CommitSet; depth: number; commits: Commit[] };

const DepthRowSchema = z.object({ depth: z.int().nonnegative() });

// Whether one of the point's own turn's sets is inside the point (TRN-060): stages
// before `beforeStage`, and for a world tick, the turn's first `worldTicksBefore`
// world-tick sets (TIME-053). `worldTicksSoFar` counts those already taken, in seq order.
function isInsidePoint(set: CommitSet, point: ReadPoint, worldTicksSoFar: number): boolean {
  if (point.beforeStage === 'end') return true;
  const stages = CommitStageSchema.options;
  if (stages.indexOf(set.stage) < stages.indexOf(point.beforeStage)) return true;
  return (
    point.beforeStage === 'world-tick' &&
    set.stage === 'world-tick' &&
    worldTicksSoFar < (point.worldTicksBefore ?? 0)
  );
}

function readCommitsBySet(db: Database, branchId: string, depth: number): Map<string, Commit[]> {
  const rows = db
    .prepare(
      `SELECT commits.id, commits.set_id, commits.seq, commits.payload
       FROM commits
       JOIN commit_sets ON commit_sets.id = commits.set_id
       JOIN branch_turns ON branch_turns.turn_id = commit_sets.turn_id
       WHERE branch_turns.branch_id = :branchId AND branch_turns.depth <= :depth
         AND commit_sets.active = 1
       ORDER BY branch_turns.depth, commit_sets.seq, commits.seq`,
    )
    .all({ branchId, depth });
  const bySet = new Map<string, Commit[]>();
  for (const row of rows) {
    const commit = parseRow('commits', CommitRowSchema, row, ['id']);
    const commits = bySet.get(commit.setId) ?? [];
    commits.push(commit);
    bySet.set(commit.setId, commits);
  }
  return bySet;
}

/**
 * Every active set a read at `point` needs, with its commits: the active sets of
 * every turn in the branch's ancestry before the point's turn, plus that turn's own
 * active sets inside the point (TRN-060). Sorted by depth, then set `seq`, then
 * commit `seq`. Not by stage: core's `orderSets` is the one definition of TRN-061's
 * order, and the caller applies it. Throws if the turn is not on the branch.
 */
export function readSetsForRead(db: Database, point: ReadPoint): SetForRead[] {
  const turnRow = db
    .prepare('SELECT depth FROM branch_turns WHERE branch_id = :branchId AND turn_id = :turnId')
    .get({ branchId: point.branchId, turnId: point.turnId });
  if (turnRow === undefined) {
    throw new Error(`readSetsForRead: turn ${point.turnId} is not on branch ${point.branchId}`);
  }
  const { depth } = parseRow('branch_turns', DepthRowSchema, turnRow, ['depth']);

  const setRows = db
    .prepare(
      `SELECT commit_sets.id, commit_sets.turn_id, commit_sets.stage, commit_sets.origin,
         commit_sets.supersedes_set_id, commit_sets.based_on_set_ids,
         commit_sets.copied_from_set_id, commit_sets.schema_version, commit_sets.seq,
         commit_sets.created_at, branch_turns.depth
       FROM commit_sets
       JOIN branch_turns ON branch_turns.turn_id = commit_sets.turn_id
       WHERE branch_turns.branch_id = :branchId AND branch_turns.depth <= :depth
         AND commit_sets.active = 1
       ORDER BY branch_turns.depth, commit_sets.seq`,
    )
    .all({ branchId: point.branchId, depth });
  const commitsBySet = readCommitsBySet(db, point.branchId, depth);

  const result: SetForRead[] = [];
  let worldTicksSoFar = 0;
  for (const row of setRows) {
    const set = parseRow('commit_sets', CommitSetRowSchema, row, ['id']);
    const setDepth = parseRow('commit_sets', DepthRowSchema, row, ['id']).depth;
    if (setDepth === depth) {
      if (!isInsidePoint(set, point, worldTicksSoFar)) continue;
      if (set.stage === 'world-tick') worldTicksSoFar += 1;
    }
    result.push({ set, depth: setDepth, commits: commitsBySet.get(set.id) ?? [] });
  }
  return result;
}
