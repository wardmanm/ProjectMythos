import { randomUUID } from 'node:crypto';
import type { CommitPayload, CommitSet, ReadPoint, Turn } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createBranch } from './branches';
import { readSetsForRead } from './read-sets';
import {
  createTestSpace,
  inputPayload,
  newTestCampaign,
  TEST_NOW,
  testBranch,
  testSet,
  testTurn,
} from './testing';
import { appendSet, insertRootTurn, insertTurn } from './turns';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const narration = (text: string): CommitPayload => ({
  type: 'narration.set',
  text,
  complete: true,
});

/** Root (setup) and turn 1 (input, narration), then turn 2 with every stage `head` needs. */
async function story() {
  const { db } = await newTestCampaign(space);
  const root = testTurn();
  const main = testBranch(root);
  const [setup] = insertRootTurn(db, {
    branch: main,
    turn: root,
    sets: [testSet(root, 'setup', [])],
  });
  const one = testTurn(root);
  const [oldInput] = insertTurn(db, {
    branchId: main.id,
    turn: one,
    sets: [testSet(one, 'input', [inputPayload('I look around.')])],
  });
  const input = appendSet(db, testSet(one, 'input', [inputPayload('I listen.')], oldInput));
  const told = appendSet(db, testSet(one, 'narration', [narration('Gulls.'), narration('Rain.')]));
  const head = testTurn(one);
  insertTurn(db, { branchId: main.id, turn: head, sets: [] });
  return { db, main, root, one, head, setup: setup!, oldInput: oldInput!, input, told };
}

const ids = (sets: { set: CommitSet }[]) => sets.map((entry) => entry.set.id);
const at = (branchId: string, turn: Turn, beforeStage: ReadPoint['beforeStage']): ReadPoint => ({
  branchId,
  turnId: turn.id,
  beforeStage,
});

describe('readSetsForRead', () => {
  it('TRN-060: returns the ancestry’s active sets with their commits and depths', async () => {
    const { db, main, head, setup, input, told } = await story();
    const sets = readSetsForRead(db, at(main.id, head, 'adjudication'));
    expect(ids(sets)).toEqual([setup.id, input.id, told.id]);
    expect(sets.map((entry) => entry.depth)).toEqual([0, 1, 1]);
    expect(sets[2]?.commits.map((commit) => [commit.seq, commit.payload])).toEqual([
      [0, narration('Gulls.')],
      [1, narration('Rain.')],
    ]);
    expect(sets[1]?.set).toEqual(input);
  });

  it('TRN-060: of the point’s own turn, only stages before the point count', async () => {
    const { db, main, head } = await story();
    const own = {
      input: appendSet(db, testSet(head, 'input', [inputPayload('I run.')])),
      ruling: appendSet(db, testSet(head, 'adjudication', [])),
      narration: appendSet(db, testSet(head, 'narration', [narration('You run.')])),
    };
    const ownIds = (point: ReadPoint) =>
      readSetsForRead(db, point)
        .filter((entry) => entry.set.turnId === head.id)
        .map((entry) => entry.set.id);
    expect(ownIds(at(main.id, head, 'adjudication'))).toEqual([own.input.id]);
    expect(ownIds(at(main.id, head, 'narration'))).toEqual([own.input.id, own.ruling.id]);
    expect(ownIds(at(main.id, head, 'end'))).toEqual([
      own.input.id,
      own.ruling.id,
      own.narration.id,
    ]);
  });

  it('TRN-060: a world-tick point includes the turn’s first worldTicksBefore world ticks', async () => {
    const { db, main, head } = await story();
    const ticks = [1, 2, 3].map(() => appendSet(db, testSet(head, 'world-tick', [])));
    const tickIds = (worldTicksBefore: number) =>
      readSetsForRead(db, { ...at(main.id, head, 'world-tick'), worldTicksBefore })
        .filter((entry) => entry.set.stage === 'world-tick')
        .map((entry) => entry.set.id);
    expect(tickIds(0)).toEqual([]);
    expect(tickIds(2)).toEqual(ticks.slice(0, 2).map((tick) => tick.id));
  });

  it('TRN-061: sorts by depth then set seq, leaving stage order to core', async () => {
    const { db, main, head } = await story();
    const extraction = appendSet(db, testSet(head, 'extraction', []));
    const input = appendSet(db, testSet(head, 'input', [inputPayload('Late input.')]));
    const own = readSetsForRead(db, at(main.id, head, 'end')).filter(
      (entry) => entry.set.turnId === head.id,
    );
    expect(ids(own)).toEqual([extraction.id, input.id]);
  });

  it('ARCH-043: sets on another branch’s turns are left out', async () => {
    const { db, main, one, head, setup, input, told } = await story();
    const fork = testBranch(one, 'Fork');
    createBranch(db, fork);
    const elsewhere = testTurn(one);
    insertTurn(db, {
      branchId: fork.id,
      turn: elsewhere,
      sets: [testSet(elsewhere, 'input', [inputPayload('Another way.')])],
    });
    expect(ids(readSetsForRead(db, at(main.id, head, 'end')))).toEqual([
      setup.id,
      input.id,
      told.id,
    ]);
    expect(() => readSetsForRead(db, at(main.id, elsewhere, 'end'))).toThrow(/is not on branch/);
  });

  it('CONV-051: a commit with corrupt JSON fails at read time, naming the table and row', async () => {
    const { db, main, head, told } = await story();
    const commitId = randomUUID();
    db.prepare(
      `INSERT INTO commits (id, set_id, seq, type, payload)
       VALUES (:id, :setId, 2, 'narration.set', '{"type": "narration.set", "text": ')`,
    ).run({ id: commitId, setId: told.id });
    expect(() => readSetsForRead(db, at(main.id, head, 'end'))).toThrow(
      new RegExp(`commits row id=${commitId} is invalid: payload: not valid JSON`),
    );
  });

  it('ARCH-051: a commit set with schemaVersion 2 fails with a clear message', async () => {
    const { db, main, head } = await story();
    db.prepare(
      `INSERT INTO commit_sets (id, turn_id, stage, origin, supersedes_set_id, based_on_set_ids,
         copied_from_set_id, schema_version, seq, created_at, active)
       VALUES (:id, :turnId, 'extraction', 'model', NULL, '[]', NULL, 2, 99, :createdAt, 1)`,
    ).run({ id: randomUUID(), turnId: head.id, createdAt: TEST_NOW.toISOString() });
    expect(() => readSetsForRead(db, at(main.id, head, 'end'))).toThrow(
      /commit set schemaVersion 2 is not supported; this version of Mythos reads schemaVersion 1 only/,
    );
  });
});
