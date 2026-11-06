import { randomUUID } from 'node:crypto';
import type { Turn } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readBranch } from './branches';
import { readTurnSets } from './read-sets';
import type { Database } from './sqlite';
import {
  countRows,
  createTestSpace,
  inputPayload,
  newTestCampaign,
  testBranch,
  testSet,
  testTurn,
} from './testing';
import {
  abandonTurn,
  appendSet,
  insertRootTurn,
  insertTurn,
  readTurn,
  readTurnsOnBranch,
  readTurnsWithStatus,
  setTurnStatus,
} from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

/** A new campaign with a root turn on branch Main. */
async function campaignWithRoot() {
  const { db } = await newTestCampaign(space);
  const root = testTurn();
  const branch = testBranch(root);
  insertRootTurn(db, { branch, turn: root, sets: [testSet(root, 'setup', [])] });
  return { db, root, branch };
}

const ActiveRowsSchema = z.array(z.object({ id: z.string(), active: z.int() }));
const activeFlags = (db: Database) =>
  new Map(
    ActiveRowsSchema.parse(db.prepare('SELECT id, active FROM commit_sets').all()).map((row) => [
      row.id,
      row.active,
    ]),
  );

describe('insertTurn', () => {
  it('TRN-011: writes the turn, its sets and commits, the new head, and its branch_turns row', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = testTurn(root);
    const input = testSet(turn, 'input', [inputPayload('I knock on the door.')]);
    const sets = insertTurn(db, { branchId: branch.id, turn, sets: [input] });

    expect(readTurn(db, turn.id)).toEqual(turn);
    expect(sets).toEqual([{ ...input.set, seq: 1 }]);
    expect(countRows(db, 'commits')).toBe(1);
    expect(readBranch(db, branch.id)?.headTurnId).toBe(turn.id);
    expect(readTurnsOnBranch(db, branch.id, null, 10).map((t) => t.id)).toEqual([root.id, turn.id]);
  });

  it('TRN-011, ARCH-041: a duplicate commit ID part-way through leaves nothing behind', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const before = { turns: countRows(db, 'turns'), sets: countRows(db, 'commit_sets') };
    const turn = testTurn(root);
    const input = testSet(turn, 'input', [inputPayload('one'), inputPayload('two')]);
    const [first, second] = input.commits;
    if (first === undefined || second === undefined) throw new Error('expected two commits');
    const broken = { ...input, commits: [first, { ...second, id: first.id }] };

    expect(() => insertTurn(db, { branchId: branch.id, turn, sets: [broken] })).toThrow(/UNIQUE/);
    expect(countRows(db, 'turns')).toBe(before.turns);
    expect(countRows(db, 'commit_sets')).toBe(before.sets);
    expect(countRows(db, 'commits')).toBe(0);
    expect(readBranch(db, branch.id)?.headTurnId).toBe(root.id);
    expect(countRows(db, 'branch_turns')).toBe(1);
  });

  it('TRN-011: a turn whose parent is not the head, or with the wrong depth, is refused', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const child = testTurn(root);
    insertTurn(db, { branchId: branch.id, turn: child, sets: [] });
    expect(() => insertTurn(db, { branchId: branch.id, turn: testTurn(root), sets: [] })).toThrow(
      /parent is not branch .* head/,
    );
    const tooDeep: Turn = { ...testTurn(child), depth: 5 };
    expect(() => insertTurn(db, { branchId: branch.id, turn: tooDeep, sets: [] })).toThrow(
      /must have depth 2/,
    );
  });

  it('TRN-003: inserting a turn adds exactly one branch_turns row', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const before = countRows(db, 'branch_turns');
    insertTurn(db, { branchId: branch.id, turn: testTurn(root), sets: [] });
    expect(countRows(db, 'branch_turns')).toBe(before + 1);
  });
});

describe('insertRootTurn', () => {
  it('TRN-011: a campaign has one root turn', async () => {
    const { db } = await campaignWithRoot();
    const another = testTurn();
    expect(() =>
      insertRootTurn(db, { branch: testBranch(another, 'Other'), turn: another, sets: [] }),
    ).toThrow('already has a root turn');
  });
});

describe('commit set seq', () => {
  it('CON-084: sets on two turns get seq 0, 1, 2 in creation order, campaign-wide', async () => {
    const { db } = await newTestCampaign(space);
    const root = testTurn();
    const branch = testBranch(root);
    const [setup] = insertRootTurn(db, {
      branch,
      turn: root,
      sets: [testSet(root, 'setup', [])],
    });
    const turn = testTurn(root);
    const [input] = insertTurn(db, {
      branchId: branch.id,
      turn,
      sets: [testSet(turn, 'input', [inputPayload('Hello.')])],
    });
    const narration = appendSet(
      db,
      testSet(turn, 'narration', [{ type: 'narration.set', text: 'Silence.', complete: true }]),
    );
    expect([setup?.seq, input?.seq, narration.seq]).toEqual([0, 1, 2]);
  });
});

describe('append-only log', () => {
  it('TRN-001: edits and deletes of commits are refused', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = testTurn(root);
    insertTurn(db, {
      branchId: branch.id,
      turn,
      sets: [testSet(turn, 'input', [inputPayload('x')])],
    });
    expect(() => {
      db.exec("UPDATE commits SET type = 'narration.set'");
    }).toThrow(/append-only/);
    expect(() => {
      db.exec('DELETE FROM commits');
    }).toThrow(/append-only/);
    expect(countRows(db, 'commits')).toBe(1);
  });

  it('TRN-001: only turns.status and commit_sets.active may change', async () => {
    const { db, root } = await campaignWithRoot();
    expect(() => {
      db.exec('UPDATE turns SET depth = 3');
    }).toThrow(/only status changes/);
    expect(() => {
      db.exec('DELETE FROM turns');
    }).toThrow(/append-only/);
    expect(() => {
      db.exec("UPDATE commit_sets SET stage = 'input'");
    }).toThrow(/only active changes/);
    expect(() => {
      db.exec('DELETE FROM commit_sets');
    }).toThrow(/append-only/);

    setTurnStatus(db, root.id, 'narrating');
    expect(readTurn(db, root.id)?.status).toBe('narrating');
    db.exec('UPDATE commit_sets SET active = 0');
  });

  it('TRN-001: a superseding set clears the old set’s active flag in the same write', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = testTurn(root);
    const [first] = insertTurn(db, {
      branchId: branch.id,
      turn,
      sets: [testSet(turn, 'input', [inputPayload('I wave.')])],
    });
    if (first === undefined) throw new Error('expected the input set');
    const edit = appendSet(db, testSet(turn, 'input', [inputPayload('I bow.')], first));
    expect(activeFlags(db).get(first.id)).toBe(0);
    expect(activeFlags(db).get(edit.id)).toBe(1);

    // A superseded set cannot be superseded again, and a set on another turn not at all.
    expect(() => appendSet(db, testSet(turn, 'input', [inputPayload('?')], first))).toThrow(
      /already superseded/,
    );
    expect(() => appendSet(db, testSet(root, 'player-edit', [], edit))).toThrow(/on another turn/);
  });
});

describe('reading turns', () => {
  it('TRN-011: readTurnsOnBranch pages back through history in depth order', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turns = [root];
    for (let i = 0; i < 4; i += 1) {
      const turn = testTurn(turns.at(-1) ?? null);
      insertTurn(db, { branchId: branch.id, turn, sets: [] });
      turns.push(turn);
    }
    const ids = turns.map((turn) => turn.id);
    expect(readTurnsOnBranch(db, branch.id, null, 2).map((t) => t.id)).toEqual(ids.slice(3));
    expect(readTurnsOnBranch(db, branch.id, 3, 2).map((t) => t.id)).toEqual(ids.slice(1, 3));
    expect(readTurnsOnBranch(db, branch.id, 1, 10).map((t) => t.id)).toEqual([root.id]);
    expect(readTurn(db, 'e0b8f6c2-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('stage results and abandoning', () => {
  const narrationPayload = (text: string) => ({
    type: 'narration.set' as const,
    text,
    complete: true,
  });

  it('TRN-123: appendSet with a status writes the set and the status together', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = { ...testTurn(root), status: 'narrating' as const };
    insertTurn(db, { branchId: branch.id, turn, sets: [] });
    appendSet(db, testSet(turn, 'narration', [narrationPayload('The door opens.')]), 'complete');
    expect(readTurn(db, turn.id)?.status).toBe('complete');

    // A set that fails to write leaves the status as it was.
    const broken = testSet(turn, 'narration', [narrationPayload('Again.')], { id: randomUUID() });
    expect(() => appendSet(db, broken, 'stage-failed')).toThrow(/unknown set/);
    expect(readTurn(db, turn.id)?.status).toBe('complete');
  });

  it('TRN-047: abandonTurn moves the head back to the parent and keeps the turn off the branch', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = { ...testTurn(root), status: 'narrating' as const };
    insertTurn(db, {
      branchId: branch.id,
      turn,
      sets: [testSet(turn, 'input', [inputPayload('Hm.')])],
    });
    abandonTurn(db, branch.id, turn.id);

    expect(readBranch(db, branch.id)?.headTurnId).toBe(root.id);
    expect(readTurn(db, turn.id)?.status).toBe('abandoned');
    expect(readTurnsOnBranch(db, branch.id, null, 10).map((t) => t.id)).toEqual([root.id]);
    // Not deleted: its input is still there to hand back.
    expect(readTurnSets(db, turn.id).map(({ commits }) => commits.map((c) => c.payload))).toEqual([
      [inputPayload('Hm.')],
    ]);
    // The new head can take a child again.
    const next = testTurn(root);
    insertTurn(db, { branchId: branch.id, turn: next, sets: [] });
    expect(readBranch(db, branch.id)?.headTurnId).toBe(next.id);
  });

  it('TRN-047: abandonTurn refuses the root and a turn that is not the head, changing nothing', async () => {
    const { db, root, branch } = await campaignWithRoot();
    expect(() => {
      abandonTurn(db, branch.id, root.id);
    }).toThrow(/is the root/);
    const turn = testTurn(root);
    insertTurn(db, { branchId: branch.id, turn, sets: [] });
    expect(() => {
      abandonTurn(db, branch.id, root.id);
    }).toThrow(/not the head/);
    expect(readBranch(db, branch.id)?.headTurnId).toBe(turn.id);
    expect(readTurn(db, root.id)?.status).toBe('complete');
  });

  it('CON-081: readTurnSets gives one turn its active sets, in seq order, with their commits', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = testTurn(root);
    const input = testSet(turn, 'input', [inputPayload('One.'), inputPayload('Two.')]);
    insertTurn(db, { branchId: branch.id, turn, sets: [input] });
    const first = testSet(turn, 'narration', [narrationPayload('First.')]);
    appendSet(db, first);
    appendSet(db, testSet(turn, 'narration', [narrationPayload('Second.')], first.set));

    const sets = readTurnSets(db, turn.id);
    expect(sets.map(({ set }) => set.stage)).toEqual(['input', 'narration']);
    expect(sets.map(({ commits }) => commits.map((c) => c.payload))).toEqual([
      [inputPayload('One.'), inputPayload('Two.')],
      [narrationPayload('Second.')],
    ]);
    expect(readTurnSets(db, randomUUID())).toEqual([]);
  });

  it('TRN-012: readTurnsWithStatus finds the turns in the statuses asked for', async () => {
    const { db, root, branch } = await campaignWithRoot();
    const turn = { ...testTurn(root), status: 'narrating' as const };
    insertTurn(db, { branchId: branch.id, turn, sets: [] });
    expect(readTurnsWithStatus(db, ['adjudicating', 'narrating'])).toEqual([turn]);
    expect(readTurnsWithStatus(db, ['complete']).map((t) => t.id)).toEqual([root.id]);
    expect(readTurnsWithStatus(db, [])).toEqual([]);
  });
});
