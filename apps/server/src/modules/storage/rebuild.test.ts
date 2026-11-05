import type { Turn } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBranch } from './branches';
import { rebuildProjections } from './rebuild';
import type { Database } from './sqlite';
import {
  createTestSpace,
  inputPayload,
  newTestCampaign,
  testBranch,
  testSet,
  testTurn,
} from './testing';
import { appendSet, insertRootTurn, insertTurn } from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const BranchTurnsSchema = z.array(
  z.object({ branch_id: z.string(), turn_id: z.string(), depth: z.int() }),
);
const ActiveSchema = z.array(z.object({ id: z.string(), active: z.int() }));

/** The projections, in a stable order, as plain values. */
function projections(db: Database) {
  return {
    branchTurns: BranchTurnsSchema.parse(
      db
        .prepare('SELECT branch_id, turn_id, depth FROM branch_turns ORDER BY branch_id, depth')
        .all(),
    ),
    active: ActiveSchema.parse(db.prepare('SELECT id, active FROM commit_sets ORDER BY seq').all()),
  };
}

/** Six turns on Main with an edited input on each, and a fork at turn 2 with its own turn. */
async function playedCampaign() {
  const { db } = await newTestCampaign(space);
  const root = testTurn();
  const main = testBranch(root);
  insertRootTurn(db, { branch: main, turn: root, sets: [testSet(root, 'setup', [])] });
  const turns: Turn[] = [root];
  for (let i = 1; i < 6; i += 1) {
    const turn = testTurn(turns.at(-1) ?? null);
    const [input] = insertTurn(db, {
      branchId: main.id,
      turn,
      sets: [testSet(turn, 'input', [inputPayload(`Turn ${String(i)}.`)])],
    });
    if (input === undefined) throw new Error('expected an input set');
    appendSet(db, testSet(turn, 'input', [inputPayload(`Turn ${String(i)}, edited.`)], input));
    turns.push(turn);
  }
  const forkAt = turns[2];
  if (forkAt === undefined) throw new Error('expected turn 2');
  const fork = testBranch(forkAt, 'Fork');
  createBranch(db, fork);
  insertTurn(db, { branchId: fork.id, turn: testTurn(forkAt), sets: [] });
  return db;
}

describe('rebuildProjections', () => {
  it('ARCH-042, TRN-003: rebuilding after a chain of turns reproduces branch_turns and active', async () => {
    const db = await playedCampaign();
    const before = projections(db);
    expect(before.branchTurns).toHaveLength(6 + 4);

    rebuildProjections(db);
    expect(projections(db)).toEqual(before);

    // From damaged projections too: no branch_turns rows, and every set active.
    db.exec('DELETE FROM branch_turns');
    db.exec('UPDATE commit_sets SET active = 1');
    rebuildProjections(db);
    expect(projections(db)).toEqual(before);
  });
});
