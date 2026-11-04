import type { Entity, EntityWikiPage, Observation } from '@mythos/contracts';

/** Entities a knower has encountered: any role in an observation they know (JRN-010). */
export function knownEntityIds(known: Observation[], knowerId: string, extra: string[] = []): Set<string> {
  const ids = new Set<string>([knowerId, ...extra]);
  for (const o of known) {
    for (const id of [...o.actorIds, ...o.witnessIds, ...o.mentionedIds]) ids.add(id);
    if (o.placeId) ids.add(o.placeId);
    if (o.claim) { ids.add(o.claim.sourceId); o.claim.audienceIds.forEach((a) => ids.add(a)); }
  }
  return ids;
}

/**
 * The name a knower uses for an entity (JRN-020): the latest name they learned; their own
 * name; for places, factions, and items, the entity's name; otherwise a descriptor.
 */
export function displayName(e: Entity, knowerId: string, learned: { entityId: string; name: string }[]): string {
  const mine = learned.filter((l) => l.entityId === e.id);
  if (mine.length) return (mine[mine.length - 1] as { name: string }).name;
  if (e.id === knowerId || (e.kind !== 'npc' && e.kind !== 'pc')) return e.name;
  return e.aliases[0] ?? 'someone you have not been introduced to';
}

/** A wiki section is visible only if the knower knows every observation it rests on (JRN-030). */
export function visibleSections(page: EntityWikiPage, knownIds: Set<string>) {
  return page.learned
    .filter((s) => s.sourceObservationIds.length > 0 && s.sourceObservationIds.every((id) => knownIds.has(id)))
    .map((s) => ({ heading: s.heading, body: s.body }));
}

/** The canon section authors mark as public (JRN-031). */
export function commonKnowledge(canon: string): string | null {
  const m = canon.match(/^##\s+Common knowledge\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im);
  const body = m?.[1]?.trim();
  return body ? body : null;
}
