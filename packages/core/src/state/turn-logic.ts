// Which commit sets count, and in what order they apply (06-turn-engine §6, 03-contracts
// §10.1). Copy-on-write ID remapping arrives with branches in phase 2.
import {
  type Commit,
  type CommitSet,
  type CommitStage,
  CommitStageSchema,
} from '@mythos/contracts';
import type { CommitSetEntry } from './fold';

const STAGE_ORDER: readonly CommitStage[] = CommitStageSchema.options;

function stageIndex(set: CommitSet): number {
  return STAGE_ORDER.indexOf(set.stage);
}

/**
 * Sets in application order: turn depth, then stage in `CommitStageSchema` order, then
 * the set's `seq`. `depthByTurnId` gives the depth of every set's turn. This is the only
 * definition of the order; the fold applies sets as given. Implements TRN-061 and CON-084.
 */
export function orderSets(
  sets: readonly CommitSet[],
  depthByTurnId: Readonly<Record<string, number>>,
): CommitSet[] {
  const withDepth = sets.map((set) => {
    const depth = depthByTurnId[set.turnId];
    if (depth === undefined) throw new Error(`orderSets: no depth for turn ${set.turnId}`);
    return { set, depth };
  });
  return withDepth
    .sort(
      (a, b) => a.depth - b.depth || stageIndex(a.set) - stageIndex(b.set) || a.set.seq - b.set.seq,
    )
    .map(({ set }) => set);
}

/** A read point's set as storage returns it: with its commits and its turn's depth. */
export type SetWithDepth = { set: CommitSet; depth: number; commits: readonly Commit[] };

/**
 * A read point's sets, each with its commits, in application order (`orderSets`), ready
 * to fold. Every server read of folded state starts here, so the order has one
 * definition (TRN-061).
 */
export function entriesInOrder(sets: readonly SetWithDepth[]): CommitSetEntry[] {
  const depthByTurnId = Object.fromEntries(sets.map(({ set, depth }) => [set.turnId, depth]));
  const commitsBySetId = new Map(sets.map(({ set, commits }) => [set.id, commits]));
  return orderSets(
    sets.map(({ set }) => set),
    depthByTurnId,
  ).map((set) => ({ set, commits: commitsBySetId.get(set.id) ?? [] }));
}

/**
 * The sets no other set in `sets` supersedes. Only active sets affect state.
 * Implements CON-081.
 */
export function activeSets(sets: readonly CommitSet[]): CommitSet[] {
  const superseded = new Set<string>();
  for (const set of sets) {
    if (set.supersedesSetId !== null) superseded.add(set.supersedesSetId);
  }
  return sets.filter((set) => !superseded.has(set.id));
}

/**
 * The stages, in pipeline order, that have an active set based on a set that is no
 * longer active. `sets` is every version of one turn's sets, so a set it doesn't hold
 * counts as inactive. Staleness is derived, never stored. Implements CON-083.
 */
export function staleStages(sets: readonly CommitSet[]): CommitStage[] {
  const active = activeSets(sets);
  const activeIds = new Set(active.map((set) => set.id));
  const stale = new Set<CommitStage>();
  for (const set of active) {
    if (set.basedOnSetIds.some((id) => !activeIds.has(id))) stale.add(set.stage);
  }
  return STAGE_ORDER.filter((stage) => stale.has(stage));
}
