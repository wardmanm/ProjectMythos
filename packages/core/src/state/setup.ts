// The setup set (04-content-schemas §11): the root turn's one `setup` set, built from a
// loaded pack and the player's choices, in SCH-117's order. Pure: IDs come from `newId`,
// and nothing here reads a file or a clock.
import type { Character, CommitPayload, Entity, Status } from '@mythos/contracts';
import type {
  AuthoredCharacter,
  CalendarDefinition,
  HistoryEntry,
  Ruleset,
  Scenario,
  Setting,
} from '@mythos/contracts/content';
import { cmp } from '../compare';
import { formatDate } from '../time/calendar-display';
import { fromDate, toDate } from '../time/calendar';
import { historyPayloads, type SeedRelationship, withoutOtherPcs } from './setup-history';

export type { SeedRelationship } from './setup-history';

/** A starting status as authored (04-content-schemas §8.3). */
export type AuthoredStatus = AuthoredCharacter['startingStatuses'][number];

/** What setup needs from a loaded pack. The content module's `LoadedPack` fits it. */
export type SetupPack = {
  setting: Pick<Setting, 'epoch' | 'epochWeekday'>;
  calendar: CalendarDefinition;
  /** Every entity in runtime form (SCH-005), premade PCs not chosen included. */
  entities: readonly { entity: Entity }[];
  /** Each character's starting statuses, by character ID. */
  startingStatuses: Readonly<Record<string, readonly AuthoredStatus[]>>;
  /** In file order. */
  history: readonly HistoryEntry[];
  /** In file order. */
  relationships: readonly SeedRelationship[];
};

/** The player's choices, already checked against the pack. */
export type SetupChoices = {
  scenario: Pick<Scenario, 'start' | 'startPlaceId' | 'presentEntityIds'>;
  /** The chosen premade PC (SCH-113). */
  pcId: string;
  /** The campaign's ruleset, which seed relationships are fitted to (SCH-092). */
  ruleset: Ruleset;
  /** The root turn, which setup's observations belong to. */
  turnId: string;
};

/** The setup set's commits, in order, and what setup changed from the pack. */
export type Setup = {
  /** The first scene's ID, for the campaign record and `initialState` (SCH-118). */
  sceneId: string;
  /** The scenario's start as game time: the root turn's `gameTimeStart`. */
  startGameTime: number;
  payloads: CommitPayload[];
  /** One plain-English line per removal, drop, or clamp (SCH-092, SCH-116). */
  warnings: string[];
};

const KIND_RANK: Readonly<Record<Entity['kind'], number>> = {
  place: 0,
  faction: 1,
  pc: 2,
  npc: 2,
  item: 3,
};

/** The entity of the same kind that must be created first: a parent place or a container. */
function holderId(entity: Entity): string | null {
  if (entity.kind === 'place') return entity.parentPlaceId;
  if (entity.kind === 'item' && entity.location.type === 'contained') {
    return entity.location.containerId;
  }
  return null;
}

/**
 * Places, factions, characters, then items, each kind by ID with `cmp`, except that a
 * parent place or a container that sorts later moves up to just before the first entity
 * inside it. Implements SCH-117 step 1.
 */
export function creationOrder(entities: readonly Entity[]): Entity[] {
  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const sorted = [...entities].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || cmp(a.id, b.id),
  );
  const ordered: Entity[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (entity: Entity): void => {
    if (done.has(entity.id)) return;
    // The loader rejects cycles (SCH-100), so one here is a defect.
    if (visiting.has(entity.id)) throw new Error(`creationOrder: ${entity.id} contains itself`);
    visiting.add(entity.id);
    const holder = byId.get(holderId(entity) ?? '');
    if (holder !== undefined) visit(holder);
    done.add(entity.id);
    ordered.push(entity);
  };
  for (const entity of sorted) visit(entity);
  return ordered;
}

/** An authored starting status as a status, inflicted at the scenario's start (SCH-005). */
function startingStatus(authored: AuthoredStatus, id: string, at: number): Status {
  return {
    id,
    name: authored.name,
    kind: authored.kind,
    ...(authored.level === undefined ? {} : { level: authored.level }),
    tags: authored.tags,
    ...(authored.note === undefined ? {} : { note: authored.note }),
    permanent: false,
    treated: false,
    inflictedAt: at,
    changedAt: at,
  };
}

function withStartingStatuses(
  entity: Entity,
  pack: SetupPack,
  at: number,
  newId: () => string,
): Entity {
  if (entity.kind !== 'pc' && entity.kind !== 'npc') return entity;
  const authored = pack.startingStatuses[entity.id] ?? [];
  const statuses = authored.map((status) => startingStatus(status, newId(), at));
  return { ...entity, statuses: [...entity.statuses, ...statuses] };
}

/** From game time 0, the epoch, to the scenario's start, unless they are the same. */
function timeAdvance({ calendar, setting }: SetupPack, startGameTime: number): CommitPayload[] {
  if (startGameTime === 0) return [];
  const date = toDate(calendar, setting.epoch, setting.epochWeekday, startGameTime);
  const reason = `The scenario starts: ${formatDate(calendar, date)}.`;
  return [{ type: 'time.advance', minutes: startGameTime, reason }];
}

/** The PC, then each present character, moved to the start place if they start elsewhere. */
function moves(
  entities: readonly Entity[],
  pcId: string,
  presentEntityIds: readonly string[],
  startPlaceId: string,
): CommitPayload[] {
  const characters = new Map(
    entities.flatMap((entity): [string, Character][] =>
      entity.kind === 'pc' || entity.kind === 'npc' ? [[entity.id, entity]] : [],
    ),
  );
  const ids = [...new Set([pcId, ...presentEntityIds])];
  return ids.flatMap((characterId): CommitPayload[] =>
    characters.get(characterId)?.locationId === startPlaceId
      ? []
      : [{ type: 'entity.move', characterId, toPlaceId: startPlaceId }],
  );
}

/**
 * A seed relationship fitted to the campaign's ruleset: a dimension it does not define is
 * dropped, and a value outside its range clamped, each with a warning. Implements SCH-092.
 */
function seedRelationship(
  seed: SeedRelationship,
  ruleset: Ruleset,
  warnings: string[],
): CommitPayload {
  const { dimensions, min, max } = ruleset.relationships;
  const at = `the relationship from ${seed.fromId} to ${seed.toId}`;
  const fitted: Record<string, number> = {};
  for (const [name, value] of Object.entries(seed.dimensions)) {
    if (!dimensions.some((dimension) => dimension.id === name)) {
      warnings.push(`${at} drops "${name}": it is not a dimension in ${ruleset.id}`);
      continue;
    }
    const clamped = Math.min(max, Math.max(min, value));
    if (clamped !== value) {
      warnings.push(
        `${at} has ${name} ${String(value)}, outside ${ruleset.id}'s ${String(min)} to ` +
          `${String(max)}, so it is ${String(clamped)}`,
      );
    }
    fitted[name] = clamped;
  }
  return {
    type: 'relationship.set',
    fromId: seed.fromId,
    toId: seed.toId,
    dimensions: fitted,
    summary: seed.summary,
  };
}

/**
 * The PC learns the name of every other character in a history entry the PC holds a
 * grant for: actors, witnesses, and a claim's source and audience, in ID order.
 * Implements JRN-022.
 */
function pcNames(entities: readonly Entity[], pcId: string, history: CommitPayload[]) {
  const pcKnows = new Set(
    history.flatMap((payload) =>
      payload.type === 'knowledge.grant' && payload.grant.entityId === pcId
        ? [payload.grant.observationId]
        : [],
    ),
  );
  const named = new Set<string>();
  for (const payload of history) {
    if (payload.type !== 'observation.add' || !pcKnows.has(payload.observation.id)) continue;
    const { actorIds, witnessIds, claim } = payload.observation;
    const ids = [
      ...actorIds,
      ...witnessIds,
      ...(claim ? [claim.sourceId, ...claim.audienceIds] : []),
    ];
    for (const id of ids) named.add(id);
  }
  return entities
    .filter((entity) => (entity.kind === 'pc' || entity.kind === 'npc') && entity.id !== pcId)
    .filter((entity) => named.has(entity.id))
    .sort((a, b) => cmp(a.id, b.id))
    .map((entity): CommitPayload => ({
      type: 'knowledge.name',
      knowerId: pcId,
      entityId: entity.id,
      name: entity.name,
    }));
}

/**
 * The root turn's setup set, in SCH-117's order: entities, the time advance, moves and the
 * first scene, history, relationships, and the PC's names. Only the chosen PC is
 * instantiated. Starting statuses get IDs from `newId` and the scenario's start as their
 * times. The result still needs `validateSet` before it is written (TRN-070).
 * Implements SCH-005, SCH-112, SCH-117, and TRN-056.
 */
export function buildSetup(pack: SetupPack, choices: SetupChoices, newId: () => string): Setup {
  const { scenario, pcId, ruleset, turnId } = choices;
  const { calendar, setting } = pack;
  const pruned = withoutOtherPcs(
    {
      entities: pack.entities.map(({ entity }) => entity),
      history: pack.history,
      relationships: pack.relationships,
      presentEntityIds: scenario.presentEntityIds,
    },
    pcId,
  );
  const warnings = [...pruned.warnings];
  const startGameTime = fromDate(calendar, setting.epoch, scenario.start);

  const creates = creationOrder(pruned.entities).map((entity): CommitPayload => ({
    type: 'entity.create',
    entity: withStartingStatuses(entity, pack, startGameTime, newId),
  }));
  const sceneId = newId();
  const history = historyPayloads(
    pruned.history,
    { calendar, epoch: setting.epoch, turnId },
    newId,
  );
  const payloads: CommitPayload[] = [
    ...creates,
    ...timeAdvance(pack, startGameTime),
    ...moves(pruned.entities, pcId, pruned.presentEntityIds, scenario.startPlaceId),
    { type: 'scene.start', sceneId, placeId: scenario.startPlaceId },
    ...history,
    ...pruned.relationships.map((seed) => seedRelationship(seed, ruleset, warnings)),
    ...pcNames(pruned.entities, pcId, history),
  ];
  return { sceneId, startGameTime, payloads, warnings };
}
