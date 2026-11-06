// What campaign creation writes once its folder and `campaign` row exist: the content
// snapshot, the first campaign state, the root turn with its setup set, and branch Main.
// One command, so one transaction (TRN-123, 01-architecture Decisions).
import type { Branch, CommitSet, Turn, WallTime } from '@mythos/contracts';
import type { ContentSettings } from '@mythos/contracts/content';
import { type CanonSnapshot, insertCanon } from './canon';
import { writeState } from './campaign-state';
import type { Database } from './sqlite';
import { insertRootTurnRows, type NewCommitSet } from './turns';

export type CampaignStart = {
  /** The content snapshot (SCH-111, CTX-005). */
  canon: CanonSnapshot;
  /** The first `content_settings` version (CSET-020). */
  contentSettings: ContentSettings;
  /** The first branch; it also becomes `current_branch_id` (TRN-101). */
  branch: Branch;
  /** The root turn. */
  turn: Turn;
  /** The root turn's sets: its setup set (SCH-117). */
  sets: readonly NewCommitSet[];
  /** When the campaign state versions were written. */
  createdAt: WallTime;
};

/**
 * Writes a new campaign's canon, its `content_settings` and `current_branch_id`, the root
 * turn with its sets, and the first branch, all in one transaction: either the campaign
 * can be played or none of it is there. Returns the sets with their `seq`. Implements
 * TRN-123, SCH-111, and CSET-020.
 */
export function writeCampaignStart(db: Database, start: CampaignStart): CommitSet[] {
  return db.transaction(() => {
    insertCanon(db, start.canon);
    const sets = insertRootTurnRows(db, {
      branch: start.branch,
      turn: start.turn,
      sets: start.sets,
    });
    writeState(db, 'content_settings', start.contentSettings, start.createdAt);
    writeState(db, 'current_branch_id', start.branch.id, start.createdAt);
    return sets;
  });
}
