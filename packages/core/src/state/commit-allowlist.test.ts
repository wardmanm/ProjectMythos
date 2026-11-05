import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommitPayloadSchema, type CommitType } from '@mythos/contracts';
import { type Ruleset, RulesetSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { cmp } from '../compare';
import { COMMIT_ALLOWLIST, stageIssues } from './commit-allowlist';
import { commitSet } from './test-support';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ruleset = RulesetSchema.parse(
  JSON.parse(
    readFileSync(path.join(repoRoot, 'content-library/rulesets/ruleset.standard.json'), 'utf8'),
  ),
);
const narrativeStatuses: Ruleset = {
  ...ruleset,
  ownership: { statuses: 'narrative', clocks: 'authoritative' },
};

const types: CommitType[] = CommitPayloadSchema.options.map((option) => option.shape.type.value);

describe('COMMIT_ALLOWLIST', () => {
  it('CON-085: every commit type has exactly one row', () => {
    expect(Object.keys(COMMIT_ALLOWLIST).sort(cmp)).toEqual([...types].sort(cmp));
  });
});

describe('stageIssues', () => {
  const extraction = commitSet(1, 'extraction', { origin: 'model' });

  it("CON-005: a type outside its row's stages is rejected, naming the stage", () => {
    expect(stageIssues('time.advance', extraction, ruleset)).toEqual([
      'time.advance is not allowed in extraction sets',
    ]);
    expect(stageIssues('time.advance', commitSet(2, 'resolution'), ruleset)).toEqual([]);
    expect(stageIssues('relationship.set', extraction, ruleset)).toHaveLength(1);
  });

  it('TRN-056: setup takes every world-state and memory type, and nothing else', () => {
    const setup = commitSet(3, 'setup');
    const allowed = types.filter((type) => stageIssues(type, setup, ruleset).length === 0);
    expect(allowed).toEqual(
      types.filter((type) => ['world state', 'memory'].includes(COMMIT_ALLOWLIST[type].affects)),
    );
    expect(allowed).toContain('relationship.set');
    expect(allowed).toContain('knowledge.name');
    expect(allowed).not.toContain('narration.set');
    expect(allowed).not.toContain('tick.record');
    expect(allowed).not.toContain('note.upsert');
  });

  it('CON-005: override.record needs a set with origin player', () => {
    const edit = commitSet(4, 'player-edit', { origin: 'player' });
    expect(stageIssues('override.record', edit, ruleset)).toEqual([]);
    expect(stageIssues('override.record', extraction, ruleset)).toEqual([
      'override.record needs a set with origin player',
    ]);
  });

  it('CON-005: extraction may write statuses or clocks only when the ruleset makes them narrative', () => {
    expect(stageIssues('status.add', extraction, ruleset)).toHaveLength(1);
    expect(stageIssues('status.add', extraction, narrativeStatuses)).toEqual([]);
    expect(stageIssues('clock.tick', extraction, narrativeStatuses)).toHaveLength(1);
    // Narrative ownership opens extraction only, not other stages.
    const narration = commitSet(5, 'narration');
    expect(stageIssues('status.add', narration, narrativeStatuses)).toHaveLength(1);
  });

  it('CON-071: consolidation sets may grant knowledge of their summaries', () => {
    const consolidation = commitSet(6, 'consolidation');
    expect(stageIssues('observation.add', consolidation, ruleset)).toEqual([]);
    expect(stageIssues('knowledge.grant', consolidation, ruleset)).toEqual([]);
  });
});
