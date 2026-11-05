// Rebuilds the projections from the event log (ARCH-042). P1-T20's
// `rebuild-projections` command runs it; later phases add their projections here.
import { insertAncestry, listBranches } from './branches';
import type { Database } from './sqlite';

/**
 * Rebuilds `branch_turns` from `turns` and `branches`, and `commit_sets.active` from
 * supersession, in one transaction. Running it on a consistent database changes
 * nothing. Implements ARCH-042 and TRN-003.
 */
export function rebuildProjections(db: Database): void {
  db.transaction(() => {
    db.exec('DELETE FROM branch_turns');
    for (const branch of listBranches(db)) insertAncestry(db, branch.id, branch.headTurnId);
    // A set is active unless a later set supersedes it (CON-081).
    db.exec(
      `UPDATE commit_sets SET active = NOT EXISTS (
         SELECT 1 FROM commit_sets AS later WHERE later.supersedes_set_id = commit_sets.id
       )`,
    );
  });
}
