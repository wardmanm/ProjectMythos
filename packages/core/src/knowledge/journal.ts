// Names and public lore from a knower's point of view (10-journal §3, §4). The rest of the
// journal arrives in phase 5.
import type { Entity } from '@mythos/contracts';

/** What a knower calls a character they have not been introduced to and have no alias for. */
const UNINTRODUCED = 'someone you have not been introduced to';

/**
 * The name a knower uses for an entity: the latest name they learned; else, for
 * themselves or a place, faction, or item, its name; else a character's first alias;
 * else "someone you have not been introduced to". `learned` holds the knower's
 * `knowledge.name` commits, in commit order.
 * Implements JRN-020.
 */
export function displayName(
  entity: Entity,
  knowerId: string,
  learned: readonly { entityId: string; name: string }[],
): string {
  const mine = learned.filter((entry) => entry.entityId === entity.id);
  const latest = mine[mine.length - 1];
  if (latest !== undefined) return latest.name;
  if (entity.id === knowerId) return entity.name;
  if (entity.kind !== 'npc' && entity.kind !== 'pc') return entity.name;
  return entity.aliases[0] ?? UNINTRODUCED;
}

const COMMON_KNOWLEDGE_HEADING = /^##\s+common knowledge\s*$/i;
const LEVEL_TWO_HEADING = /^##\s/;

/**
 * The `## Common knowledge` section of an entity's canon Markdown, trimmed: the lore the
 * player may see once the PC knows the entity. Null when there is no such section or it
 * is empty. Implements JRN-031.
 */
export function commonKnowledge(canon: string): string | null {
  const lines = canon.split(/\r?\n/);
  const start = lines.findIndex((line) => COMMON_KNOWLEDGE_HEADING.test(line));
  if (start === -1) return null;
  const section: string[] = [];
  // The section runs to the next level-two heading; deeper headings belong to it.
  for (const line of lines.slice(start + 1)) {
    if (LEVEL_TWO_HEADING.test(line)) break;
    section.push(line);
  }
  const body = section.join('\n').trim();
  return body === '' ? null : body;
}
