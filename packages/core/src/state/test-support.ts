// Builders shared by the state tests. Not part of core's API: index.ts does not export
// them. Tests load the ruleset and slot schema themselves, since only test files may read
// files.
import type {
  Character,
  CommitPayload,
  CommitSet,
  CommitStage,
  Item,
  ItemLocation,
  Observation,
  Place,
} from '@mythos/contracts';
import type { CommitSetEntry } from './fold';
import { type FoldedState, initialState } from './folded-state';

/** A valid UUID ending in `n`, so test IDs read in order. */
export function testId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export const ROOT_TURN = testId(1);
export const FIRST_SCENE = testId(2);

/** A pc or npc, by the prefix of its ID, alive and adult. */
export function character(id: string, extra: Partial<Character> = {}): Character {
  return {
    id,
    kind: id.startsWith('pc.') ? 'pc' : 'npc',
    name: id.slice(id.indexOf('.') + 1),
    aliases: [],
    tags: [],
    ageCategory: 'adult',
    stats: { str: 2, end: 2, dex: 2, int: 2, cha: 2 },
    statuses: [],
    physicalDescription: '',
    personality: '',
    goals: [],
    keyNpc: false,
    locationId: null,
    lifeState: 'alive',
    ...extra,
  };
}

export function place(id: string, parentPlaceId: string | null = null): Place {
  return {
    id,
    kind: 'place',
    name: id.slice(id.indexOf('.') + 1),
    aliases: [],
    tags: [],
    parentPlaceId,
    description: '',
  };
}

export function item(id: string, location: ItemLocation, extra: Partial<Item> = {}): Item {
  return {
    id,
    kind: 'item',
    name: id.slice(id.indexOf('.') + 1),
    aliases: [],
    tags: [],
    description: '',
    location,
    ownerId: null,
    quantity: 1,
    size: 'small',
    bonuses: [],
    ...extra,
  };
}

export function observation(n: number, extra: Partial<Observation> = {}): Observation {
  return {
    id: testId(n),
    turnId: ROOT_TURN,
    gameTime: 0,
    placeId: null,
    kind: 'event',
    text: 'Something happened.',
    actorIds: [],
    witnessIds: [],
    mentionedIds: [],
    importance: 3,
    tags: [],
    ...extra,
  };
}

/** A `witnessed` grant of `observationId` to `entityId` (CON-071). */
export function witnessed(entityId: string, observationId: string): CommitPayload {
  return {
    type: 'knowledge.grant',
    grant: { entityId, observationId, via: 'witnessed', viaObservationId: null, gameTime: 0 },
  };
}

/** Set number `n`: its ID is `testId(n)`, and `n` is also its `seq`. */
export function commitSet(
  n: number,
  stage: CommitStage,
  extra: Partial<CommitSet> = {},
): CommitSet {
  return {
    id: testId(n),
    turnId: ROOT_TURN,
    stage,
    origin: 'engine',
    supersedesSetId: null,
    basedOnSetIds: [],
    copiedFromSetId: null,
    schemaVersion: 1,
    seq: n,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

/** A set and its commits, numbered in the order given. */
export function entryOf(set: CommitSet, payloads: readonly CommitPayload[]): CommitSetEntry {
  return {
    set,
    commits: payloads.map((payload, index) => ({
      id: testId(1000 * set.seq + index + 1),
      setId: set.id,
      seq: index,
      payload,
    })),
  };
}

export const startState = (): FoldedState =>
  initialState({ pcId: 'pc.wren', scenePlaceId: 'place.inn', sceneId: FIRST_SCENE });

export const HELLO = testId(50);

/**
 * A setup set in SCH-117's order for a small world: a town and its inn, Wren and Odette,
 * and Wren's satchel. Wren arrives at the inn at 18:00 on day one, where she and Odette
 * meet.
 */
export function setupEntry(): CommitSetEntry {
  return entryOf(commitSet(10, 'setup'), [
    // The town comes first, though "place.inn" sorts before it: a parent place precedes
    // the places inside it (SCH-117).
    { type: 'entity.create', entity: place('place.town') },
    { type: 'entity.create', entity: place('place.inn', 'place.town') },
    {
      type: 'entity.create',
      entity: character('npc.odette', { locationId: 'place.inn' }),
    },
    { type: 'entity.create', entity: character('pc.wren', { locationId: 'place.town' }) },
    {
      type: 'entity.create',
      entity: item(
        'item.satchel',
        { type: 'held', characterId: 'pc.wren' },
        { ownerId: 'pc.wren', size: 'medium', container: { capacity: 8, maxItemSize: 'small' } },
      ),
    },
    { type: 'time.advance', minutes: 18 * 60, reason: 'The scenario starts at 18:00.' },
    { type: 'entity.move', characterId: 'pc.wren', toPlaceId: 'place.inn' },
    { type: 'scene.start', sceneId: FIRST_SCENE, placeId: 'place.inn' },
    {
      type: 'observation.add',
      observation: observation(50, {
        placeId: 'place.inn',
        text: 'Wren and Odette met at the inn.',
        actorIds: ['pc.wren', 'npc.odette'],
        witnessIds: ['pc.wren', 'npc.odette'],
      }),
    },
    witnessed('pc.wren', HELLO),
    witnessed('npc.odette', HELLO),
    {
      type: 'relationship.set',
      fromId: 'npc.odette',
      toId: 'pc.wren',
      dimensions: { trust: 1 },
      summary: 'A stranger with a satchel.',
    },
    { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.odette', name: 'Odette' },
  ]);
}
