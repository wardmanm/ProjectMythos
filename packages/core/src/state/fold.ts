// Folding commit sets into state (06-turn-engine §6.2, §6.4). Both directions step
// through a set one commit at a time, checking each against the state so far, so a
// commit sees the earlier ones in its set: setup creates a container before its contents.
// Writing is strict and rejects the whole set; replay is lenient and skips what fails.
import {
  type AppError,
  type Commit,
  type CommitPayload,
  type CommitSet,
  err,
  type ItemLocation,
  ok,
  type ReplayConflict,
  type Result,
  type SemanticIssue,
} from '@mythos/contracts';
import { applyCommit } from './apply-commit';
import type { FoldContext, FoldedState } from './folded-state';
import { commitIssues, witnessGrantIssues } from './validate';

/** One commit set with its commits. Commits apply in `seq` order (CON-084). */
export type CommitSetEntry = { set: CommitSet; commits: readonly Commit[] };

/** A commit that failed validation, at its index in its entry's `commits`. */
type Failure = { index: number; commit: Commit; issues: SemanticIssue[] };

function stepThrough(
  state: FoldedState,
  entry: CommitSetEntry,
  context: FoldContext,
): { state: FoldedState; failures: Failure[] } {
  const inOrder = entry.commits
    .map((commit, index) => ({ commit, index }))
    .sort((a, b) => a.commit.seq - b.commit.seq);
  let current = state;
  const failures: Failure[] = [];
  for (const { commit, index } of inOrder) {
    const issues = commitIssues(current, commit.payload, entry.set, context);
    // A failing commit is never applied.
    if (issues.length > 0) failures.push({ index, commit, issues });
    else current = applyCommit(current, commit.payload);
  }
  return { state: current, failures };
}

function locationEntityId(to: ItemLocation): string | null {
  switch (to.type) {
    case 'worn':
    case 'held':
    case 'carried':
      return to.characterId;
    case 'contained':
      return to.containerId;
    case 'placed':
      return to.placeId;
    case 'gone':
      return null;
  }
}

function namedIds(payload: CommitPayload): (string | null | undefined)[] {
  switch (payload.type) {
    case 'entity.create':
      return [payload.entity.id];
    case 'entity.move':
      return [payload.characterId, payload.toPlaceId];
    case 'item.move':
      return [payload.itemId, locationEntityId(payload.to), payload.ownerId];
    case 'scene.start':
      return [payload.placeId];
    case 'relationship.set':
      return [payload.fromId, payload.toId];
    case 'knowledge.name':
      return [payload.knowerId, payload.entityId];
    case 'knowledge.grant':
      return [payload.grant.entityId];
    case 'observation.add': {
      const o = payload.observation;
      const claim = o.claim === undefined ? [] : [o.claim.sourceId, ...o.claim.audienceIds];
      return [o.placeId, ...o.actorIds, ...o.witnessIds, ...o.mentionedIds, ...claim];
    }
    // Turn content, time, and flags name no entity. Types without a reducer add theirs
    // with it (06-turn-engine Open).
    default:
      return [];
  }
}

/** The entities a replay conflict concerns: those its commit names, each once. */
function entityIdsOf(payload: CommitPayload): string[] {
  const named = namedIds(payload).filter((id): id is string => id !== null && id !== undefined);
  return [...new Set(named)];
}

/**
 * Folds `entries`, which are active and in application order (`orderSets`), onto
 * `state`. Lenient: a commit that fails validation is skipped and recorded as a replay
 * conflict, and the rest of its set applies. The same inputs always give the same
 * result. Implements TRN-065 and TRN-071.
 */
export function fold(
  state: FoldedState,
  entries: readonly CommitSetEntry[],
  context: FoldContext,
): { state: FoldedState; conflicts: ReplayConflict[] } {
  let current = state;
  const conflicts: ReplayConflict[] = [];
  for (const entry of entries) {
    const result = stepThrough(current, entry, context);
    current = result.state;
    for (const { commit, issues } of result.failures) {
      conflicts.push({
        turnId: entry.set.turnId,
        setId: entry.set.id,
        commitId: commit.id,
        commitType: commit.payload.type,
        reason: issues.map((found) => found.message).join('; '),
        entityIds: entityIdsOf(commit.payload),
      });
    }
  }
  return { state: current, conflicts };
}

/**
 * The state after a new set, or `illegal_state_change` listing every issue when any
 * commit fails or a witness lacks a grant (CON-071). Strict: nothing applies unless all
 * of it does. `details` is `{ issues }`, each at a path into the entry. Implements
 * CON-005 and TRN-070.
 */
export function validateSet(
  state: FoldedState,
  entry: CommitSetEntry,
  context: FoldContext,
): Result<FoldedState, AppError> {
  const result = stepThrough(state, entry, context);
  const issues: SemanticIssue[] = [
    ...result.failures.flatMap(({ index, issues: found }) =>
      found.map((each) => ({
        path: `commits.${String(index)}.payload.${each.path}`,
        message: each.message,
      })),
    ),
    ...witnessGrantIssues(entry.commits),
  ];
  if (issues.length === 0) return ok(result.state);
  const count = issues.length === 1 ? '1 problem' : `${String(issues.length)} problems`;
  return err({
    code: 'illegal_state_change',
    message: `The ${entry.set.stage} set was not applied: ${count}.`,
    details: { issues },
  });
}
