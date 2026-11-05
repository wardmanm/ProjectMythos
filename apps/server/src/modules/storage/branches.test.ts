import type { Turn } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createBranch, listBranches, readBranch } from './branches';
import {
  countRows,
  createTestSpace,
  newTestCampaign,
  testBranch,
  testSet,
  testTurn,
} from './testing';
import { insertRootTurn, insertTurn, readTurnsOnBranch } from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

/** A campaign with a chain of `length` turns on Main, root first. */
async function chain(length: number) {
  const { db } = await newTestCampaign(space);
  const root = testTurn();
  const main = testBranch(root);
  insertRootTurn(db, { branch: main, turn: root, sets: [testSet(root, 'setup', [])] });
  const turns: Turn[] = [root];
  while (turns.length < length) {
    const turn = testTurn(turns.at(-1) ?? null);
    insertTurn(db, { branchId: main.id, turn, sets: [] });
    turns.push(turn);
  }
  return { db, main, turns };
}

describe('branches', () => {
  it('TRN-002: creating a branch writes no commit sets or commits', async () => {
    const { db, turns } = await chain(3);
    const before = { sets: countRows(db, 'commit_sets'), commits: countRows(db, 'commits') };
    const at = turns[1]!;
    const fork = { ...testBranch(at, 'Fork'), forkedFromTurnId: at.id };
    createBranch(db, fork);
    expect(countRows(db, 'commit_sets')).toBe(before.sets);
    expect(countRows(db, 'commits')).toBe(before.commits);
    expect(readBranch(db, fork.id)).toEqual(fork);
  });

  it('TRN-003: a fork at a turn gets that turn’s ancestry and no turns are copied', async () => {
    const { db, main, turns } = await chain(4);
    const at = turns[1]!;
    const fork = testBranch(at, 'Fork');
    createBranch(db, fork);
    expect(readTurnsOnBranch(db, fork.id, null, 10).map((t) => t.id)).toEqual([
      turns[0]!.id,
      at.id,
    ]);
    expect(countRows(db, 'turns')).toBe(4);

    // Each branch grows on its own.
    const next = testTurn(at);
    insertTurn(db, { branchId: fork.id, turn: next, sets: [] });
    expect(readTurnsOnBranch(db, fork.id, null, 10)).toHaveLength(3);
    expect(readTurnsOnBranch(db, main.id, null, 10)).toHaveLength(4);
  });

  it('TRN-002: branches list in creation order, archived ones included', async () => {
    const { db, main, turns } = await chain(2);
    const archived = { ...testBranch(turns[1]!, 'Before rewind'), archived: true };
    createBranch(db, archived);
    expect(listBranches(db).map((b) => [b.name, b.archived])).toEqual([
      [main.name, false],
      ['Before rewind', true],
    ]);
    expect(readBranch(db, 'e0b8f6c2-0000-4000-8000-000000000000')).toBeNull();
  });
});
