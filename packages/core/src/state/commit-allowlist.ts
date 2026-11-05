// The commit allowlist (03-contracts §10.2): which stages may write each commit type.
import {
  type CommitSet,
  type CommitStage,
  CommitStageSchema,
  type CommitType,
} from '@mythos/contracts';
import type { Ruleset } from '@mythos/contracts/content';

/** What a commit type changes, as the table's Affects column has it. */
export type Affects =
  'turn content' | 'audit only' | 'world state' | 'world-tick log' | 'memory' | 'journal';

export type AllowlistRow = {
  affects: Affects;
  /** Stages that may write the type. `override.record` is limited by the set instead. */
  stages: readonly CommitStage[];
  /**
   * The table's †: extraction may also write the type when this ownership field of the
   * ruleset is `narrative` (07-rules §9).
   */
  narrative?: keyof Ruleset['ownership'];
};

const allStages: readonly CommitStage[] = CommitStageSchema.options;

const outcome: readonly CommitStage[] = ['resolution', 'world-tick', 'player-edit'];
const anywhere: readonly CommitStage[] = ['resolution', 'extraction', 'world-tick', 'player-edit'];
const learned: readonly CommitStage[] = ['extraction', 'world-tick', 'player-edit'];

/** Implements CON-085: a new commit type fails to compile until it has a row. */
export const COMMIT_ALLOWLIST: Readonly<Record<CommitType, AllowlistRow>> = {
  'input.set': { affects: 'turn content', stages: ['input', 'player-edit'] },
  'ruling.set': { affects: 'turn content', stages: ['adjudication', 'player-edit'] },
  'roll.record': { affects: 'turn content', stages: ['resolution'] },
  'resolution.record': { affects: 'turn content', stages: ['resolution'] },
  'narration.set': { affects: 'turn content', stages: ['narration', 'player-edit'] },
  'override.record': { affects: 'audit only', stages: allStages },
  'entity.create': { affects: 'world state', stages: anywhere },
  'entity.update-narrative': { affects: 'world state', stages: learned },
  'entity.move': { affects: 'world state', stages: anywhere },
  'entity.death': { affects: 'world state', stages: outcome },
  'stat.change': { affects: 'world state', stages: outcome },
  'status.add': { affects: 'world state', stages: outcome, narrative: 'statuses' },
  'status.update': { affects: 'world state', stages: outcome, narrative: 'statuses' },
  'status.remove': { affects: 'world state', stages: outcome, narrative: 'statuses' },
  'harm.mitigate': { affects: 'world state', stages: ['resolution', 'player-edit'] },
  'clock.create': { affects: 'world state', stages: outcome, narrative: 'clocks' },
  'clock.tick': { affects: 'world state', stages: outcome, narrative: 'clocks' },
  'clock.delete': { affects: 'world state', stages: outcome, narrative: 'clocks' },
  'item.move': { affects: 'world state', stages: anywhere },
  'item.quantity': { affects: 'world state', stages: anywhere },
  'time.advance': { affects: 'world state', stages: ['resolution', 'player-edit'] },
  'scene.start': { affects: 'world state', stages: ['resolution', 'extraction', 'player-edit'] },
  'tick.record': { affects: 'world-tick log', stages: ['world-tick'] },
  'flag.set': { affects: 'world state', stages: anywhere },
  'observation.add': {
    affects: 'memory',
    stages: ['extraction', 'world-tick', 'consolidation', 'player-edit'],
  },
  'observation.amend': { affects: 'memory', stages: ['player-edit'] },
  'knowledge.grant': {
    affects: 'memory',
    stages: ['extraction', 'world-tick', 'consolidation', 'player-edit'],
  },
  'knowledge.revoke': { affects: 'memory', stages: ['player-edit'] },
  'knowledge.name': { affects: 'memory', stages: learned },
  'relationship.adjust': { affects: 'memory', stages: learned },
  'relationship.set': { affects: 'memory', stages: ['player-edit'] },
  'wiki.patch': {
    affects: 'memory',
    stages: ['extraction', 'world-tick', 'consolidation', 'player-edit'],
  },
  'note.upsert': { affects: 'journal', stages: ['player-edit'] },
  'note.delete': { affects: 'journal', stages: ['player-edit'] },
  'belief.upsert': { affects: 'journal', stages: ['player-edit'] },
  'belief.delete': { affects: 'journal', stages: ['player-edit'] },
};

function allowed(type: CommitType, set: CommitSet, ruleset: Ruleset): boolean {
  const row = COMMIT_ALLOWLIST[type];
  // Implements TRN-080: a regenerated set keeps origin model but supersedes another.
  if (type === 'override.record') return set.origin === 'player' || set.supersedesSetId !== null;
  // Implements TRN-056: setup takes any world-state or memory type.
  if (set.stage === 'setup') return row.affects === 'world state' || row.affects === 'memory';
  if (row.stages.includes(set.stage)) return true;
  return (
    set.stage === 'extraction' &&
    row.narrative !== undefined &&
    ruleset.ownership[row.narrative] === 'narrative'
  );
}

/**
 * Why a commit of `type` may not be in `set`: empty when it may, else one message.
 * `override.record` needs a set with origin `player` or one that supersedes another.
 */
export function stageIssues(type: CommitType, set: CommitSet, ruleset: Ruleset): string[] {
  if (allowed(type, set, ruleset)) return [];
  return type === 'override.record'
    ? [`${type} needs a set with origin player, or one that supersedes another`]
    : [`${type} is not allowed in ${set.stage} sets`];
}
