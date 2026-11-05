import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CommitPayload,
  CommitSchema,
  type ReplayConflict,
  SemanticIssueSchema,
  WorldStateSchema,
} from '@mythos/contracts';
import { RulesetSchema, SlotSchemaDefinitionSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { type CommitSetEntry, fold, validateSet } from './fold';
import type { FoldContext, FoldedState } from './folded-state';
import {
  character,
  commitSet,
  FIRST_SCENE,
  HELLO,
  item,
  observation,
  place,
  ROOT_TURN,
  entryOf,
  setupEntry,
  startState,
  testId,
  witnessed,
} from './test-support';
import { activeSets, orderSets } from './turn-logic';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
const context: FoldContext = {
  ruleset: RulesetSchema.parse(readJson('content-library/rulesets/ruleset.standard.json')),
  slots: SlotSchemaDefinitionSchema.parse(
    readJson('content-packs/reference/slot-schemas/slots.everyday.json'),
  ),
};

const TURN_1 = testId(201);
const TURN_2 = testId(202);

function foldedSetup(): FoldedState {
  const setup = validateSet(startState(), setupEntry(), context);
  if (!setup.ok) throw new Error(JSON.stringify(setup.error));
  return setup.value;
}

/** The issues of an `illegal_state_change`, parsed as the client would. */
function rejectedIssues(entry: CommitSetEntry, state: FoldedState = foldedSetup()) {
  const result = validateSet(state, entry, context);
  if (result.ok) throw new Error('expected the set to be rejected');
  expect(result.error.code).toBe('illegal_state_change');
  const details = result.error.details as { issues: unknown[] };
  return details.issues.map((found) => SemanticIssueSchema.parse(found));
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

describe('fold', () => {
  it('SCH-118, TRN-065: a setup set for two characters and one item folds to the expected world', () => {
    const entry = setupEntry();
    for (const commit of entry.commits) expect(CommitSchema.parse(commit)).toEqual(commit);

    const { state, conflicts } = fold(startState(), [entry], context);
    expect(conflicts).toEqual([]);
    const satchel = item(
      'item.satchel',
      { type: 'held', characterId: 'pc.wren' },
      { ownerId: 'pc.wren', size: 'medium', container: { capacity: 8, maxItemSize: 'small' } },
    );
    expect(state.world).toEqual({
      gameTime: 18 * 60,
      sceneId: FIRST_SCENE,
      scenePlaceId: 'place.inn',
      pcId: 'pc.wren',
      entities: {
        'place.town': place('place.town'),
        'place.inn': place('place.inn', 'place.town'),
        'npc.odette': character('npc.odette', { locationId: 'place.inn' }),
        'pc.wren': character('pc.wren', { locationId: 'place.inn' }),
        'item.satchel': satchel,
      },
      clocks: {},
      flags: {},
    });
    expect(state).toEqual(foldedSetup());
  });

  it('TRN-064: the folded state holds world, relationships, names, and observation IDs, as plain data', () => {
    const state = foldedSetup();
    expect(WorldStateSchema.parse(state.world)).toEqual(state.world);
    expect(state.relationships).toEqual({
      'npc.odette>pc.wren': {
        fromId: 'npc.odette',
        toId: 'pc.wren',
        dimensions: { trust: 1 },
        summary: 'A stranger with a satchel.',
        keyObservationIds: [],
      },
    });
    expect(state.names).toEqual({ 'pc.wren': { 'npc.odette': 'Odette' } });
    expect(state.knownObservationIds).toEqual([HELLO]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('TRN-071: a commit that no longer validates is skipped and recorded, and the rest of its set applies', () => {
    // Turn 1 first created a ferryman, and turn 2 sent him to town. A retcon replaced
    // turn 1's extraction with one that creates nobody.
    const turn1 = entryOf(commitSet(30, 'extraction', { turnId: TURN_1 }), [
      { type: 'flag.set', key: 'storm', value: true },
    ]);
    const turn2 = entryOf(commitSet(31, 'extraction', { turnId: TURN_2 }), [
      { type: 'entity.move', characterId: 'npc.ferryman', toPlaceId: 'place.town' },
      { type: 'entity.move', characterId: 'npc.odette', toPlaceId: 'place.town' },
    ]);
    const { state, conflicts } = fold(foldedSetup(), [turn1, turn2], context);

    expect(conflicts).toEqual<ReplayConflict[]>([
      {
        turnId: TURN_2,
        setId: turn2.set.id,
        commitId: turn2.commits[0]?.id ?? '',
        commitType: 'entity.move',
        reason: '"npc.ferryman" does not exist',
        entityIds: ['npc.ferryman', 'place.town'],
      },
    ]);
    expect(state.world.entities['npc.odette']).toMatchObject({ locationId: 'place.town' });
    expect(state.world.flags).toEqual({ storm: true });
  });

  it('TRN-071: replay does not check witness grants, which are a write-time check', () => {
    const ungranted = entryOf(commitSet(32, 'extraction', { turnId: TURN_1 }), [
      { type: 'observation.add', observation: observation(80, { witnessIds: ['pc.wren'] }) },
    ]);
    expect(fold(foldedSetup(), [ungranted], context).conflicts).toEqual([]);
  });

  it('TRN-065: folding the same sets twice gives deep-equal state and conflicts', () => {
    const entries = [
      setupEntry(),
      entryOf(commitSet(33, 'player-edit', { turnId: TURN_1, origin: 'player' }), [
        { type: 'entity.move', characterId: 'npc.missing', toPlaceId: null },
        { type: 'time.advance', minutes: 15, reason: 'waiting' },
      ]),
    ];
    const first = fold(startState(), entries, context);
    const second = fold(startState(), entries, context);
    expect(first.conflicts).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('CON-080: folding never changes its inputs, so deep-frozen commits fold without throwing', () => {
    const state = deepFreeze(foldedSetup());
    const entries = deepFreeze([
      entryOf(commitSet(34, 'player-edit', { turnId: TURN_1, origin: 'player' }), [
        { type: 'entity.create', entity: character('npc.pip', { locationId: 'place.inn' }) },
        { type: 'flag.set', key: 'bell', value: 'rung' },
        { type: 'flag.set', key: 'bell', value: null },
        { type: 'time.advance', minutes: 5, reason: 'a pause' },
        { type: 'entity.move', characterId: 'pc.wren', toPlaceId: 'place.town' },
        { type: 'item.move', itemId: 'item.satchel', to: { type: 'placed', placeId: 'place.inn' } },
        {
          type: 'relationship.set',
          fromId: 'npc.odette',
          toId: 'pc.wren',
          dimensions: { fear: 1 },
          summary: null,
        },
        { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.odette', name: 'Det' },
        { type: 'observation.add', observation: observation(81) },
      ]),
    ]);
    const frozenContext = deepFreeze(structuredClone(context));
    const result = fold(state, entries, frozenContext);
    expect(result.conflicts).toEqual([]);
    expect(result.state.world.gameTime).toBe(state.world.gameTime + 5);
    expect(state).toEqual(foldedSetup());
  });

  it('CON-082: player-edit sets accumulate, while a new narration set replaces the old one', () => {
    const edit1 = commitSet(35, 'player-edit', { turnId: TURN_1, origin: 'player' });
    const edit2 = commitSet(36, 'player-edit', { turnId: TURN_1, origin: 'player' });
    const narration1 = commitSet(37, 'narration', { turnId: TURN_1, origin: 'model' });
    const narration2 = commitSet(38, 'narration', {
      turnId: TURN_1,
      origin: 'model',
      supersedesSetId: narration1.id,
    });
    const active = orderSets(activeSets([edit1, narration1, edit2, narration2]), {
      [TURN_1]: 1,
    });
    expect(active).toEqual([narration2, edit1, edit2]);

    const payloads: Record<string, CommitPayload[]> = {
      [edit1.id]: [{ type: 'flag.set', key: 'first', value: 1 }],
      [edit2.id]: [{ type: 'flag.set', key: 'second', value: 2 }],
      [narration2.id]: [{ type: 'narration.set', text: 'The bell rings.', complete: true }],
    };
    const entries = active.map((set) => entryOf(set, payloads[set.id] ?? []));
    expect(fold(foldedSetup(), entries, context).state.world.flags).toEqual({
      first: 1,
      second: 2,
    });
  });
});

describe('validateSet', () => {
  it('CON-005, TRN-070: a set with three violations is rejected with all three, and nothing applies', () => {
    const hands = entryOf(commitSet(40, 'player-edit', { origin: 'player' }), [
      {
        type: 'entity.create',
        entity: item('item.lantern', { type: 'held', characterId: 'pc.wren' }),
      },
      {
        type: 'entity.create',
        entity: item('item.knife', { type: 'placed', placeId: 'place.inn' }),
      },
    ]);
    const full = validateSet(foldedSetup(), hands, context);
    if (!full.ok) throw new Error(JSON.stringify(full.error));

    const broken = entryOf(commitSet(41, 'extraction', { origin: 'model' }), [
      { type: 'time.advance', minutes: 60, reason: 'extraction never advances time' },
      { type: 'entity.move', characterId: 'pc.wren', toPlaceId: 'place.lighthouse' },
      { type: 'item.move', itemId: 'item.knife', to: { type: 'held', characterId: 'pc.wren' } },
    ]);
    const result = validateSet(full.value, broken, context);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'illegal_state_change',
        message: 'The extraction set was not applied: 3 problems.',
        details: {
          issues: [
            {
              path: 'commits.0.payload.type',
              message: 'time.advance is not allowed in extraction sets',
            },
            { path: 'commits.1.payload.toPlaceId', message: '"place.lighthouse" does not exist' },
            { path: 'commits.2.payload.to', message: 'wren has no free hand' },
          ],
        },
      },
    });
  });

  it('CON-071: a witness without a witnessed grant in the same set rejects the set', () => {
    const seen = observation(82, { witnessIds: ['pc.wren', 'npc.odette'], placeId: 'place.inn' });
    const missing = entryOf(commitSet(42, 'extraction', { origin: 'model' }), [
      { type: 'observation.add', observation: seen },
      witnessed('pc.wren', seen.id),
    ]);
    expect(rejectedIssues(missing)).toEqual([
      {
        path: 'commits.0.payload.observation.witnessIds.1',
        message: 'npc.odette witnessed this but has no witnessed grant in the set',
      },
    ]);

    const granted = entryOf(missing.set, [
      { type: 'observation.add', observation: seen },
      witnessed('pc.wren', seen.id),
      witnessed('npc.odette', seen.id),
    ]);
    expect(validateSet(foldedSetup(), granted, context).ok).toBe(true);
  });

  it('TRN-070: each commit is checked against the state the earlier commits in its set leave', () => {
    const box = item(
      'item.box',
      { type: 'held', characterId: 'pc.wren' },
      {
        size: 'small',
        container: { capacity: 4, maxItemSize: 'tiny' },
      },
    );
    const ring = item(
      'item.ring',
      { type: 'contained', containerId: 'item.box' },
      { size: 'tiny' },
    );
    const set = commitSet(43, 'player-edit', { origin: 'player' });
    const inOrder = entryOf(set, [
      { type: 'entity.create', entity: box },
      { type: 'entity.create', entity: ring },
    ]);
    expect(validateSet(foldedSetup(), inOrder, context).ok).toBe(true);

    const contentsFirst = entryOf(set, [
      { type: 'entity.create', entity: ring },
      { type: 'entity.create', entity: box },
    ]);
    expect(rejectedIssues(contentsFirst)).toEqual([
      { path: 'commits.0.payload.entity.location', message: 'there is no "item.box" to put it in' },
    ]);

    // Commits apply by seq, whatever order the entry lists them in.
    const listedBackwards = { ...inOrder, commits: [...inOrder.commits].reverse() };
    expect(validateSet(foldedSetup(), listedBackwards, context).ok).toBe(true);
  });

  it('TRN-070: a place inside another needs its parent created first', () => {
    const childFirst = entryOf(commitSet(44, 'setup', { turnId: ROOT_TURN }), [
      { type: 'entity.create', entity: place('place.cellar', 'place.tavern') },
      { type: 'entity.create', entity: place('place.tavern') },
    ]);
    expect(rejectedIssues(childFirst, startState())).toEqual([
      { path: 'commits.0.payload.entity.parentPlaceId', message: '"place.tavern" does not exist' },
    ]);
  });
});
