// Semantic validation of commits (03-contracts, 06-turn-engine §6.4): the checks beyond
// schema shape, against the state at the commit's point. Every issue is reported, never
// just the first, each at a dotted path into the commit's payload.
import type {
  Character,
  Commit,
  CommitPayload,
  CommitSet,
  Entity,
  Item,
  ItemLocation,
  Observation,
  SemanticIssue,
} from '@mythos/contracts';
import type { Ruleset } from '@mythos/contracts/content';
import { validateItemMove } from '../rules/gear';
import { stageIssues } from './commit-allowlist';
import type { FoldContext, FoldedState } from './folded-state';

type Payload<T extends CommitPayload['type']> = Extract<CommitPayload, { type: T }>;

/** The kinds of entity a reference may name, and how a message describes them. */
type Expected = { kinds: readonly Entity['kind'][]; label: string };

const CHARACTER: Expected = { kinds: ['pc', 'npc'], label: 'a character' };
const PLACE: Expected = { kinds: ['place'], label: 'a place' };
const ITEM: Expected = { kinds: ['item'], label: 'an item' };
const ACTOR: Expected = { kinds: ['pc', 'npc', 'faction'], label: 'a character or faction' };
const ANY: Expected = { kinds: ['pc', 'npc', 'place', 'faction', 'item'], label: 'an entity' };

const KIND_LABELS: Readonly<Record<Entity['kind'], string>> = {
  pc: 'a character',
  npc: 'a character',
  place: 'a place',
  faction: 'a faction',
  item: 'an item',
};

const issue = (path: string, message: string): SemanticIssue => ({ path, message });

/**
 * Implements CON-041: a reference names an existing entity of the expected kind. A null
 * or absent one, such as an off-map character's location, names nothing to check.
 */
function reference(
  state: FoldedState,
  path: string,
  id: string | null | undefined,
  expected: Expected,
): SemanticIssue[] {
  if (id === null || id === undefined) return [];
  const entity = state.world.entities[id];
  if (entity === undefined) return [issue(path, `"${id}" does not exist`)];
  if (expected.kinds.includes(entity.kind)) return [];
  return [issue(path, `"${id}" is ${KIND_LABELS[entity.kind]}, not ${expected.label}`)];
}

function references(
  state: FoldedState,
  path: string,
  ids: readonly string[],
  expected: Expected,
): SemanticIssue[] {
  return ids.flatMap((id, index) => reference(state, `${path}.${String(index)}`, id, expected));
}

function knownObservation(state: FoldedState, path: string, id: string | null): SemanticIssue[] {
  if (id === null || state.knownObservationIds.includes(id)) return [];
  return [issue(path, `observation "${id}" is not known at this point`)];
}

/** Characters and places an item location names; containers are gear's to check. */
function locationReferences(state: FoldedState, path: string, to: ItemLocation): SemanticIssue[] {
  switch (to.type) {
    case 'worn':
    case 'held':
    case 'carried':
      return reference(state, `${path}.characterId`, to.characterId, CHARACTER);
    case 'placed':
      return reference(state, `${path}.placeId`, to.placeId, PLACE);
    // validateItemMove reports a missing container (11-gear Decisions).
    case 'contained':
    case 'gone':
      return [];
  }
}

/** Whether `item` may be at `to`: references first, then the gear rules (GEAR-053). */
function placementIssues(
  state: FoldedState,
  path: string,
  item: Item,
  to: ItemLocation,
  context: FoldContext,
): SemanticIssue[] {
  const missing = locationReferences(state, path, to);
  if (missing.length > 0) return missing;
  const entities = Object.values(state.world.entities);
  const items = entities.filter((entity): entity is Item => entity.kind === 'item');
  const characters: Record<string, Character> = {};
  for (const entity of entities) {
    if (entity.kind === 'pc' || entity.kind === 'npc') characters[entity.id] = entity;
  }
  return validateItemMove(item, to, items, characters, context.slots, context.ruleset).map(
    (message) => issue(path, message),
  );
}

function createIssues(state: FoldedState, entity: Entity, context: FoldContext): SemanticIssue[] {
  // Implements CSET-044: an ID is created once, so a character's ageCategory never changes.
  if (state.world.entities[entity.id] !== undefined) {
    return [issue('entity.id', `"${entity.id}" already exists`)];
  }
  switch (entity.kind) {
    case 'pc':
    case 'npc':
      return reference(state, 'entity.locationId', entity.locationId, PLACE);
    case 'place':
      return reference(state, 'entity.parentPlaceId', entity.parentPlaceId, PLACE);
    case 'faction':
      return [];
    case 'item':
      return [
        ...placementIssues(state, 'entity.location', entity, entity.location, context),
        ...reference(state, 'entity.ownerId', entity.ownerId, ACTOR),
      ];
  }
}

function itemMoveIssues(
  state: FoldedState,
  payload: Payload<'item.move'>,
  context: FoldContext,
): SemanticIssue[] {
  const owner = reference(state, 'ownerId', payload.ownerId, ACTOR);
  const item = state.world.entities[payload.itemId];
  if (item?.kind !== 'item') return [...reference(state, 'itemId', payload.itemId, ITEM), ...owner];
  return [...placementIssues(state, 'to', item, payload.to, context), ...owner];
}

/** Implements CON-070: a claim has `claim`, and a summary what it summarizes. */
function observationShapeIssues(observation: Observation): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const { kind } = observation;
  if ((kind === 'claim') !== (observation.claim !== undefined)) {
    const message =
      kind === 'claim' ? 'a claim needs "claim"' : `${kind} observations have no "claim"`;
    issues.push(issue('observation.claim', message));
  }
  const summarizes = (observation.summarizesIds ?? []).length > 0;
  if ((kind === 'summary') !== summarizes) {
    const message =
      kind === 'summary'
        ? 'a summary needs what it summarizes'
        : `${kind} observations summarize nothing`;
    issues.push(issue('observation.summarizesIds', message));
  }
  return issues;
}

function observationIssues(state: FoldedState, observation: Observation): SemanticIssue[] {
  const at = (field: string): string => `observation.${field}`;
  const claim = observation.claim;
  const isNew = !state.knownObservationIds.includes(observation.id);
  return [
    ...observationShapeIssues(observation),
    ...(isNew ? [] : [issue(at('id'), `observation "${observation.id}" already exists`)]),
    ...reference(state, at('placeId'), observation.placeId, PLACE),
    ...references(state, at('actorIds'), observation.actorIds, ACTOR),
    ...references(state, at('witnessIds'), observation.witnessIds, CHARACTER),
    ...references(state, at('mentionedIds'), observation.mentionedIds, ANY),
    ...(claim === undefined
      ? []
      : [
          ...reference(state, at('claim.sourceId'), claim.sourceId, CHARACTER),
          ...references(state, at('claim.audienceIds'), claim.audienceIds, CHARACTER),
          ...knownObservation(state, at('claim.aboutObservationId'), claim.aboutObservationId),
        ]),
    ...(observation.summarizesIds ?? []).flatMap((id, index) =>
      knownObservation(state, at(`summarizesIds.${String(index)}`), id),
    ),
  ];
}

/**
 * Implements CON-073: between two different characters, on the ruleset's dimensions,
 * within its range. Faction relationships wait for a ruleset switch (03-contracts Open).
 */
function relationshipIssues(
  state: FoldedState,
  payload: Payload<'relationship.set'>,
  ruleset: Ruleset,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [
    ...reference(state, 'fromId', payload.fromId, CHARACTER),
    ...reference(state, 'toId', payload.toId, CHARACTER),
  ];
  if (payload.fromId === payload.toId) {
    issues.push(issue('toId', 'a relationship is between two different characters'));
  }
  const { dimensions, min, max } = ruleset.relationships;
  for (const [name, value] of Object.entries(payload.dimensions)) {
    const path = `dimensions.${name}`;
    if (!dimensions.some((dimension) => dimension.id === name)) {
      issues.push(issue(path, `"${name}" is not a relationship dimension in ${ruleset.id}`));
    } else if (value < min || value > max) {
      issues.push(issue(path, `${String(value)} is outside ${String(min)} to ${String(max)}`));
    }
  }
  return issues;
}

function payloadIssues(
  state: FoldedState,
  payload: CommitPayload,
  context: FoldContext,
): SemanticIssue[] {
  switch (payload.type) {
    case 'entity.create':
      return createIssues(state, payload.entity, context);
    case 'entity.move':
      return [
        ...reference(state, 'characterId', payload.characterId, CHARACTER),
        ...reference(state, 'toPlaceId', payload.toPlaceId, PLACE),
      ];
    case 'item.move':
      return itemMoveIssues(state, payload, context);
    case 'scene.start':
      return reference(state, 'placeId', payload.placeId, PLACE);
    case 'observation.add':
      return observationIssues(state, payload.observation);
    case 'knowledge.grant':
      return [
        ...reference(state, 'grant.entityId', payload.grant.entityId, CHARACTER),
        ...knownObservation(state, 'grant.observationId', payload.grant.observationId),
        ...knownObservation(state, 'grant.viaObservationId', payload.grant.viaObservationId),
      ];
    case 'knowledge.name':
      return [
        ...reference(state, 'knowerId', payload.knowerId, CHARACTER),
        ...reference(state, 'entityId', payload.entityId, ANY),
      ];
    case 'relationship.set':
      return relationshipIssues(state, payload, context.ruleset);
    // Nothing to check beyond the stage: turn content, time, flags, and the types whose
    // checks arrive with their reducers (apply-commit.ts).
    default:
      return [];
  }
}

/**
 * Every reason `payload` cannot apply to `state` as part of `set`: the stage allowlist
 * (03-contracts §10.2), references and their kinds, the gear rules, and each type's
 * invariants. Paths are dotted paths into the payload. Implements CON-005.
 */
export function commitIssues(
  state: FoldedState,
  payload: CommitPayload,
  set: CommitSet,
  context: FoldContext,
): SemanticIssue[] {
  return [
    ...stageIssues(payload.type, set, context.ruleset).map((message) => issue('type', message)),
    ...payloadIssues(state, payload, context),
  ];
}

/**
 * Every witness of an observation the set adds needs a `witnessed` grant in the same
 * set. Checked on write only, since the set builders add the grants (03-contracts
 * Decisions). Paths start at the set's `commits`. Implements CON-071.
 */
export function witnessGrantIssues(commits: readonly Commit[]): SemanticIssue[] {
  const granted = (entityId: string, observationId: string): boolean =>
    commits.some(
      ({ payload }) =>
        payload.type === 'knowledge.grant' &&
        payload.grant.via === 'witnessed' &&
        payload.grant.entityId === entityId &&
        payload.grant.observationId === observationId,
    );
  return commits.flatMap(({ payload }, index) => {
    if (payload.type !== 'observation.add') return [];
    const { id, witnessIds } = payload.observation;
    return witnessIds.flatMap((witnessId, witness) =>
      granted(witnessId, id)
        ? []
        : [
            issue(
              `commits.${String(index)}.payload.observation.witnessIds.${String(witness)}`,
              `${witnessId} witnessed this but has no witnessed grant in the set`,
            ),
          ],
    );
  });
}
