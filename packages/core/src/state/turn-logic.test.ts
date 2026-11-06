import type { CommitSet, CommitStage } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { commitSet, testId } from './test-support';
import { activeSets, entriesInOrder, orderSets, staleStages } from './turn-logic';

// One turn's sets, numbered in creation order, each based on the stages before it.
const input = commitSet(1, 'input');
const ruling = commitSet(2, 'adjudication', { basedOnSetIds: [input.id] });
const resolution = commitSet(3, 'resolution', { basedOnSetIds: [input.id, ruling.id] });
const narration = commitSet(4, 'narration', {
  basedOnSetIds: [input.id, ruling.id, resolution.id],
});
const extraction = commitSet(5, 'extraction', {
  basedOnSetIds: [input.id, ruling.id, resolution.id, narration.id],
});
const edit = commitSet(6, 'player-edit');
const turn = [input, ruling, resolution, narration, extraction, edit];

// The player edits the ruling: a new adjudication set supersedes the old one.
const ruling2 = commitSet(7, 'adjudication', {
  basedOnSetIds: [input.id],
  supersedesSetId: ruling.id,
});

const stages = (sets: readonly CommitSet[]): CommitStage[] => sets.map((set) => set.stage);

describe('activeSets', () => {
  it('CON-081: a set is active until a later set supersedes it', () => {
    expect(activeSets(turn)).toEqual(turn);
    const active = activeSets([...turn, ruling2]);
    expect(active).not.toContain(ruling);
    expect(active).toContain(ruling2);
  });
});

describe('staleStages', () => {
  it('CON-083: a fresh turn has no stale stages', () => {
    expect(staleStages(turn)).toEqual([]);
  });

  it('CON-083: a ruling edit stales resolution, narration, and extraction', () => {
    expect(staleStages([...turn, ruling2])).toEqual(['resolution', 'narration', 'extraction']);
  });

  it('CON-083: regenerating resolution and narration leaves only extraction stale', () => {
    const resolution2 = commitSet(8, 'resolution', {
      basedOnSetIds: [input.id, ruling2.id],
      supersedesSetId: resolution.id,
    });
    const narration2 = commitSet(9, 'narration', {
      basedOnSetIds: [input.id, ruling2.id, resolution2.id],
      supersedesSetId: narration.id,
    });
    const sets = [...turn, ruling2, resolution2, narration2];
    expect(staleStages(sets)).toEqual(['extraction']);

    // Restoring an older narration copies it, based on the current upstream sets.
    const narration3 = commitSet(10, 'narration', {
      basedOnSetIds: [input.id, ruling2.id, resolution2.id],
      supersedesSetId: narration2.id,
    });
    expect(staleStages([...sets, narration3])).toEqual(['extraction']);
  });

  it('CON-083: a set based on a set it was not given counts as stale', () => {
    const orphan = commitSet(11, 'narration', { basedOnSetIds: [testId(99)] });
    expect(staleStages([orphan])).toEqual(['narration']);
  });
});

describe('orderSets', () => {
  const depths = { [testId(1)]: 0 };

  it('CON-084: within a turn, sets apply in stage order, then by seq', () => {
    const shuffled = [edit, extraction, ruling2, narration, input, resolution];
    expect(stages(orderSets(shuffled, depths))).toEqual([
      'input',
      'adjudication',
      'resolution',
      'narration',
      'extraction',
      'player-edit',
    ]);
    const laterEdit = commitSet(12, 'player-edit');
    expect(orderSets([laterEdit, edit], depths)).toEqual([edit, laterEdit]);
  });

  it('TRN-061: across turns, depth comes first, then stage, then seq; superseded sets are left out', () => {
    const [turn0, turn1, turn2] = [testId(100), testId(101), testId(102)];
    const depthByTurnId = { [turn0]: 0, [turn1]: 1, [turn2]: 2 };
    const at = (n: number, turnId: string, stage: CommitStage, extra: Partial<CommitSet> = {}) =>
      commitSet(n, stage, { turnId, ...extra });
    // Created out of order: turn 2's input before turn 1's narration, and a regenerated
    // narration on turn 1.
    const setup = at(20, turn0, 'setup');
    const opening = at(21, turn0, 'narration');
    const input1 = at(22, turn1, 'input');
    const input2 = at(23, turn2, 'input');
    const narration1 = at(24, turn1, 'narration');
    const edit1 = at(25, turn1, 'player-edit');
    const narration1b = at(26, turn1, 'narration', { supersedesSetId: narration1.id });
    const narration2 = at(27, turn2, 'narration');
    const all = [narration2, narration1b, edit1, narration1, input2, input1, opening, setup];

    expect(orderSets(activeSets(all), depthByTurnId)).toEqual([
      setup,
      opening,
      input1,
      narration1b,
      edit1,
      input2,
      narration2,
    ]);
  });

  it('TRN-061: entriesInOrder puts sets as storage reads them into application order, each with its commits', () => {
    const [turn0, turn1] = [testId(110), testId(111)];
    const setup = commitSet(40, 'setup', { turnId: turn0 });
    const narration0 = commitSet(41, 'narration', { turnId: turn0 });
    const input1 = commitSet(42, 'input', { turnId: turn1 });
    const commit = (set: CommitSet, n: number) => ({
      id: testId(n),
      setId: set.id,
      seq: 0,
      payload: { type: 'input.set' as const, mode: 'ic' as const, text: `set ${String(n)}` },
    });
    // Storage sorts by depth and seq, not by stage: an edit on turn 0 made before the
    // opening narration would come back first.
    const edit0 = commitSet(39, 'player-edit', { turnId: turn0 });
    const read = [
      { set: edit0, depth: 0, commits: [commit(edit0, 139)] },
      { set: setup, depth: 0, commits: [commit(setup, 140)] },
      { set: narration0, depth: 0, commits: [] },
      { set: input1, depth: 1, commits: [commit(input1, 142)] },
    ];
    expect(entriesInOrder(read)).toEqual([
      { set: setup, commits: [commit(setup, 140)] },
      { set: narration0, commits: [] },
      { set: edit0, commits: [commit(edit0, 139)] },
      { set: input1, commits: [commit(input1, 142)] },
    ]);
  });

  it('TRN-061: a set whose turn has no depth is a programmer error', () => {
    expect(() => orderSets([commitSet(30, 'input', { turnId: testId(103) })], depths)).toThrow(
      /no depth for turn/,
    );
  });
});
