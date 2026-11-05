// The parts of the setup set that come from history (04-content-schemas §11): premade PCs
// that are not chosen are removed from everything (SCH-113, SCH-116), and each history
// entry becomes an observation with one knowledge grant per knower (SCH-117 step 4).
import type { CommitPayload, Entity, Item, KnowledgeGrant, Observation } from '@mythos/contracts';
import type { CalendarDate, CalendarDefinition, HistoryEntry } from '@mythos/contracts/content';
import { indexById, possessor } from '../rules/gear';
import { fromDate } from '../time/calendar';

/** A seed relationship in authored form (04-content-schemas §8.4). */
export type SeedRelationship = {
  fromId: string;
  toId: string;
  dimensions: Readonly<Record<string, number>>;
  summary: string;
};

/** What setup builds from: the pack with only the chosen PC left in it. */
export type Pruned = {
  entities: Entity[];
  history: HistoryEntry[];
  relationships: SeedRelationship[];
  presentEntityIds: string[];
  /** One plain-English line per removal (SCH-116). */
  warnings: string[];
};

type Unpruned = {
  entities: readonly Entity[];
  history: readonly HistoryEntry[];
  relationships: readonly SeedRelationship[];
  presentEntityIds: readonly string[];
};

function isItem(entity: Entity): entity is Item {
  return entity.kind === 'item';
}

/** Removes `dropped` from a list, with a warning for each removal. */
function without(
  ids: readonly string[],
  dropped: ReadonlySet<string>,
  warn: (id: string) => void,
): string[] {
  return ids.filter((id) => {
    if (!dropped.has(id)) return true;
    warn(id);
    return false;
  });
}

// Items a dropped PC has on them are omitted; items it only owns become nobody's.
function pruneEntities(
  entities: readonly Entity[],
  dropped: ReadonlySet<string>,
  warnings: string[],
): Entity[] {
  const itemsById = indexById(entities.filter(isItem));
  const kept: Entity[] = [];
  for (const entity of entities) {
    // Possession follows containers outward, so a dropped PC's bag takes its contents.
    const holder = isItem(entity) ? possessor(entity, itemsById) : null;
    if (dropped.has(entity.id)) {
      warnings.push(`${entity.id} is left out: a campaign has only the chosen PC`);
    } else if (holder !== null && dropped.has(holder)) {
      warnings.push(`${entity.id} is left out: ${holder} has it`);
    } else if (isItem(entity) && entity.ownerId !== null && dropped.has(entity.ownerId)) {
      warnings.push(`${entity.id} belongs to nobody: its owner, ${entity.ownerId}, is left out`);
      kept.push({ ...entity, ownerId: null });
    } else {
      kept.push(entity);
    }
  }
  return kept;
}

// One entry with the dropped PCs taken out, or null when the entry itself goes.
function pruneEntry(
  entry: HistoryEntry,
  dropped: ReadonlySet<string>,
  droppedRefs: ReadonlySet<string>,
  warnings: string[],
): HistoryEntry | null {
  const at = `history entry "${entry.ref}"`;
  const claim = entry.claim;
  if (claim !== undefined && dropped.has(claim.sourceId)) {
    warnings.push(`${at} is left out: its claim's source, ${claim.sourceId}, is left out`);
    return null;
  }
  const remove = (list: string) => (id: string) => {
    warnings.push(`${id} is removed from the ${list} of ${at}`);
  };
  const actorIds = without(entry.actorIds, dropped, remove('actors'));
  const witnessIds = without(entry.witnessIds, dropped, remove('witnesses'));
  const alsoKnownBy = entry.alsoKnownBy.filter(({ entityId }) => {
    if (!dropped.has(entityId)) return true;
    remove('other knowers')(entityId);
    return false;
  });
  if (claim === undefined) return { ...entry, actorIds, witnessIds, alsoKnownBy };
  const audienceIds = without(claim.audienceIds, dropped, remove('claim audience'));
  if (audienceIds.length === 0) {
    warnings.push(`${at} is left out: its claim has no one left to tell`);
    return null;
  }
  let aboutRef = claim.aboutRef;
  if (aboutRef !== null && droppedRefs.has(aboutRef)) {
    warnings.push(
      `${at}'s claim is about "${aboutRef}", which is left out, so it is about nothing`,
    );
    aboutRef = null;
  }
  return {
    ...entry,
    actorIds,
    witnessIds,
    alsoKnownBy,
    claim: { ...claim, audienceIds, aboutRef },
  };
}

function pruneHistory(
  history: readonly HistoryEntry[],
  dropped: ReadonlySet<string>,
  warnings: string[],
): HistoryEntry[] {
  const droppedRefs = new Set<string>();
  const kept: HistoryEntry[] = [];
  // In file order, so a claim sees whether the earlier entry it is about was dropped.
  for (const entry of history) {
    const pruned = pruneEntry(entry, dropped, droppedRefs, warnings);
    if (pruned === null) droppedRefs.add(entry.ref);
    else kept.push(pruned);
  }
  return kept;
}

/**
 * The pack with every premade PC but `pcId` removed: the PCs themselves, items they
 * possess, their ownership of other items, their places in history, relationships from or
 * to them, and their presence in the scenario. Each removal is a warning. Implements
 * SCH-113 and SCH-116.
 */
export function withoutOtherPcs(pack: Unpruned, pcId: string): Pruned {
  const pc = pack.entities.find((entity) => entity.id === pcId);
  if (pc?.kind !== 'pc') throw new Error(`withoutOtherPcs: ${pcId} is not a PC in the pack`);
  const dropped = new Set(
    pack.entities.filter((entity) => entity.kind === 'pc' && entity.id !== pcId).map((e) => e.id),
  );
  const warnings: string[] = [];
  const entities = pruneEntities(pack.entities, dropped, warnings);
  const history = pruneHistory(pack.history, dropped, warnings);
  const relationships = pack.relationships.filter(({ fromId, toId }) => {
    const gone = [fromId, toId].find((id) => dropped.has(id));
    if (gone === undefined) return true;
    warnings.push(`the relationship from ${fromId} to ${toId} is left out: ${gone} is left out`);
    return false;
  });
  const presentEntityIds = without(pack.presentEntityIds, dropped, (id) => {
    warnings.push(`${id} is not present at the start: it is left out`);
  });
  return { entities, history, relationships, presentEntityIds, warnings };
}

/** Where history's game times come from: the setting's calendar and epoch. */
export type HistoryContext = {
  calendar: CalendarDefinition;
  epoch: CalendarDate;
  /** The root turn, which every setup observation belongs to. */
  turnId: string;
};

function observationOf(
  entry: HistoryEntry,
  id: string,
  at: HistoryContext,
  observationIdByRef: ReadonlyMap<string, string>,
): Observation {
  const claim = entry.claim;
  return {
    id,
    turnId: at.turnId,
    // Undated background is stored at game time 0 (SCH-091).
    gameTime: entry.when === undefined ? 0 : fromDate(at.calendar, at.epoch, entry.when),
    placeId: entry.placeId,
    kind: entry.kind,
    text: entry.text,
    actorIds: entry.actorIds,
    witnessIds: entry.witnessIds,
    mentionedIds: [],
    importance: entry.importance,
    tags: entry.tags,
    ...(claim === undefined
      ? {}
      : {
          claim: {
            sourceId: claim.sourceId,
            audienceIds: claim.audienceIds,
            content: claim.content,
            aboutObservationId:
              claim.aboutRef === null ? null : (observationIdByRef.get(claim.aboutRef) ?? null),
            truthful: claim.truthful,
          },
        }),
  };
}

/**
 * Who knows an observation, and how: witnesses (`witnessed`), claim audience members who
 * are not witnesses (`told`), then `alsoKnownBy` with its own `via`. One grant per
 * knower: the first that applies. Implements MEM-010, MEM-034, MEM-035, and CON-071.
 */
function grantsOf(entry: HistoryEntry, observation: Observation): KnowledgeGrant[] {
  const knowers: { entityId: string; via: KnowledgeGrant['via'] }[] = [
    ...entry.witnessIds.map((entityId) => ({ entityId, via: 'witnessed' as const })),
    ...(entry.claim?.audienceIds ?? []).map((entityId) => ({ entityId, via: 'told' as const })),
    ...entry.alsoKnownBy,
  ];
  const granted = new Set<string>();
  const grants: KnowledgeGrant[] = [];
  for (const { entityId, via } of knowers) {
    if (granted.has(entityId)) continue;
    granted.add(entityId);
    grants.push({
      entityId,
      observationId: observation.id,
      via,
      viaObservationId: null,
      gameTime: observation.gameTime,
    });
  }
  return grants;
}

/**
 * Each history entry, in file order, as an `observation.add` and then its grants. A
 * claim's `aboutRef` becomes the ID of that earlier entry's observation (SCH-090). History
 * is not checked against MEM-011. Implements SCH-117 step 4.
 */
export function historyPayloads(
  history: readonly HistoryEntry[],
  at: HistoryContext,
  newId: () => string,
): CommitPayload[] {
  const observationIdByRef = new Map<string, string>();
  return history.flatMap((entry): CommitPayload[] => {
    const observation = observationOf(entry, newId(), at, observationIdByRef);
    observationIdByRef.set(entry.ref, observation.id);
    return [
      { type: 'observation.add', observation },
      ...grantsOf(entry, observation).map((grant) => ({ type: 'knowledge.grant' as const, grant })),
    ];
  });
}
