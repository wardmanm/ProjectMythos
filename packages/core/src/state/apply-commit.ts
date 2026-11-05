// The per-commit reducers the fold is built from (06-turn-engine §6.2). Each returns new
// plain data and never changes its input (CON-080). They trust their input: the fold
// validates every commit before applying it (validate.ts).
import type { CommitPayload, CommitType, Entity, Relationship } from '@mythos/contracts';
import { type FoldedState, relationshipKey } from './folded-state';

type Payload<T extends CommitType> = Extract<CommitPayload, { type: T }>;

/**
 * The phase that brings each commit type with no reducer yet. Applying one throws, so
 * nothing is silently ignored. Implements CON-085.
 */
const UNBUILT_PHASES = {
  'override.record': 2,
  'ruling.set': 3,
  'roll.record': 3,
  'resolution.record': 3,
  'entity.death': 3,
  'stat.change': 3,
  'status.add': 3,
  'status.update': 3,
  'status.remove': 3,
  'harm.mitigate': 3,
  'clock.create': 3,
  'clock.tick': 3,
  'clock.delete': 3,
  'entity.update-narrative': 4,
  'item.quantity': 4,
  'relationship.adjust': 4,
  'wiki.patch': 4,
  'observation.amend': 5,
  'knowledge.revoke': 5,
  'note.upsert': 5,
  'note.delete': 5,
  'belief.upsert': 5,
  'belief.delete': 5,
  'tick.record': 7,
} as const satisfies Partial<Record<CommitType, number>>;

type UnbuiltPayload = Payload<keyof typeof UNBUILT_PHASES>;

function isUnbuilt(payload: CommitPayload): payload is UnbuiltPayload {
  return Object.hasOwn(UNBUILT_PHASES, payload.type);
}

function withEntity(state: FoldedState, entity: Entity): FoldedState {
  const entities = { ...state.world.entities, [entity.id]: entity };
  return { ...state, world: { ...state.world, entities } };
}

function entityOf(state: FoldedState, id: string): Entity {
  const entity = state.world.entities[id];
  if (entity === undefined) throw new Error(`applyCommit: no entity ${id}`);
  return entity;
}

function moveCharacter(state: FoldedState, payload: Payload<'entity.move'>): FoldedState {
  const character = entityOf(state, payload.characterId);
  if (character.kind !== 'pc' && character.kind !== 'npc') {
    throw new Error(`applyCommit: ${character.id} is not a character`);
  }
  return withEntity(state, { ...character, locationId: payload.toPlaceId });
}

function moveItem(state: FoldedState, payload: Payload<'item.move'>): FoldedState {
  const item = entityOf(state, payload.itemId);
  if (item.kind !== 'item') throw new Error(`applyCommit: ${item.id} is not an item`);
  // An absent ownerId leaves the owner unchanged; null makes the item nobody's.
  const ownerId = payload.ownerId === undefined ? item.ownerId : payload.ownerId;
  return withEntity(state, { ...item, location: payload.to, ownerId });
}

function setFlag(state: FoldedState, payload: Payload<'flag.set'>): FoldedState {
  const others = Object.entries(state.world.flags).filter(([key]) => key !== payload.key);
  // A null value removes the flag (03-contracts Decisions).
  const flags =
    payload.value === null
      ? Object.fromEntries(others)
      : { ...state.world.flags, [payload.key]: payload.value };
  return { ...state, world: { ...state.world, flags } };
}

function setRelationship(state: FoldedState, payload: Payload<'relationship.set'>): FoldedState {
  const key = relationshipKey(payload.fromId, payload.toId);
  const existing = state.relationships[key];
  // Omitted dimensions are unchanged, and a null summary leaves the summary as it was
  // (03-contracts Decisions).
  const relationship: Relationship = {
    fromId: payload.fromId,
    toId: payload.toId,
    dimensions: { ...existing?.dimensions, ...payload.dimensions },
    summary: payload.summary ?? existing?.summary ?? '',
    keyObservationIds: existing?.keyObservationIds ?? [],
  };
  return { ...state, relationships: { ...state.relationships, [key]: relationship } };
}

function learnName(state: FoldedState, payload: Payload<'knowledge.name'>): FoldedState {
  const known = { ...state.names[payload.knowerId], [payload.entityId]: payload.name };
  return { ...state, names: { ...state.names, [payload.knowerId]: known } };
}

/**
 * The folded state after one commit. Throws for a commit type whose reducer arrives in a
 * later phase, naming that phase. Implements TRN-065 and CON-085.
 */
export function applyCommit(state: FoldedState, payload: CommitPayload): FoldedState {
  if (isUnbuilt(payload)) {
    throw new Error(`${payload.type} arrives in phase ${String(UNBUILT_PHASES[payload.type])}`);
  }
  // Exhaustive over the rest: a new commit type fails to compile until it has a case here
  // or a row in UNBUILT_PHASES.
  switch (payload.type) {
    // Turn content, and grants, whose row projection arrives in phase 4.
    case 'input.set':
    case 'narration.set':
    case 'knowledge.grant':
      return state;
    case 'entity.create':
      return withEntity(state, payload.entity);
    case 'entity.move':
      return moveCharacter(state, payload);
    case 'item.move':
      return moveItem(state, payload);
    case 'time.advance':
      return {
        ...state,
        world: { ...state.world, gameTime: state.world.gameTime + payload.minutes },
      };
    case 'scene.start':
      return {
        ...state,
        world: { ...state.world, sceneId: payload.sceneId, scenePlaceId: payload.placeId },
      };
    case 'flag.set':
      return setFlag(state, payload);
    case 'relationship.set':
      return setRelationship(state, payload);
    case 'knowledge.name':
      return learnName(state, payload);
    case 'observation.add':
      // The observation itself is a row projection (phase 4); the fold keeps its ID.
      return {
        ...state,
        knownObservationIds: [...state.knownObservationIds, payload.observation.id],
      };
    default: {
      const unhandled: never = payload;
      return unhandled;
    }
  }
}
