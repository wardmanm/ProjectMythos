// Items in pass 3 (SCH-082): slots and bonuses against the setting's slot schema and default
// ruleset, names (GEAR-065), and each starting location checked as a legal move (GEAR-053),
// with containers placed before the items inside them.
import type { Character, Item } from '@mythos/contracts';
import type { AuthoredEntity, Ruleset, SlotSchemaDefinition } from '@mythos/contracts/content';
import { validateItemMove } from '@mythos/core';
import { toRuntimeCharacter, toRuntimeItem } from './convert';
import type { PackDefaults } from './resolve';
import type { PackContent, PackIssue } from './types';

type AuthoredItem = Extract<AuthoredEntity, { kind: 'item' }>;
type Placing = { file: string; item: Item };

function slotIssues(file: string, item: AuthoredItem, slots: SlotSchemaDefinition): PackIssue[] {
  const known = new Set(slots.slots.map((slot) => slot.id));
  const check = (list: readonly string[], path: string): PackIssue[] =>
    list.flatMap((slot, index) =>
      known.has(slot)
        ? []
        : [
            {
              file,
              path: `${path}.${String(index)}`,
              message: `"${slot}" is not a slot in ${slots.id}`,
            },
          ],
    );
  return [
    ...check(item.wearable?.slots ?? [], 'wearable.slots'),
    ...check(item.wearable?.covers ?? [], 'wearable.covers'),
  ];
}

// Implements CON-024: every stat ID and status tag in a bonus is the ruleset's.
function bonusIssues(file: string, item: AuthoredItem, ruleset: Ruleset): PackIssue[] {
  const stats = new Set(ruleset.stats.list.map((stat) => stat.id));
  const tags = new Set(ruleset.harm.tags.map((tag) => tag.id));
  return item.bonuses.flatMap((bonus, index) => {
    const at = `bonuses.${String(index)}`;
    if (bonus.type === 'roll') {
      if (bonus.stat === undefined || stats.has(bonus.stat)) return [];
      return [
        { file, path: `${at}.stat`, message: `"${bonus.stat}" is not a stat in ${ruleset.id}` },
      ];
    }
    return bonus.tags.flatMap((tag, tagIndex) =>
      tags.has(tag)
        ? []
        : [
            {
              file,
              path: `${at}.tags.${String(tagIndex)}`,
              message: `"${tag}" is not a harm tag in ${ruleset.id}`,
            },
          ],
    );
  });
}

// Implements GEAR-065: names read as they do in a list.
function nameIssues(file: string, item: AuthoredItem): PackIssue[] {
  if (!/^(a|an|the) /i.test(item.name)) return [];
  return [
    {
      file,
      path: 'name',
      message: `"${item.name}" starts with an article; write it as it reads in a list`,
    },
  ];
}

/** The chain of containers above an item, if it leads back to the item itself. */
function containerCycle(item: Item, byId: ReadonlyMap<string, Item>): string[] | null {
  const chain = [item.id];
  let location = item.location;
  while (location.type === 'contained') {
    const containerId = location.containerId;
    if (containerId === item.id) return [...chain, item.id];
    const container = byId.get(containerId);
    if (container === undefined || chain.includes(containerId)) return null;
    chain.push(containerId);
    location = container.location;
  }
  return null;
}

/**
 * Places every item where it starts, one at a time, each container before its contents, and
 * reports each illegal location at `startingLocation`. Items in a container that is not an
 * item are skipped: pass 2 already reported them. Implements SCH-082.
 */
function placementIssues(
  content: PackContent,
  slots: SlotSchemaDefinition,
  ruleset: Ruleset,
): PackIssue[] {
  const characters: Record<string, Character> = {};
  const pending: Placing[] = [];
  for (const { file, entity } of content.entities.values()) {
    if (entity.kind === 'pc' || entity.kind === 'npc')
      characters[entity.id] = toRuntimeCharacter(entity);
    if (entity.kind === 'item') pending.push({ file, item: toRuntimeItem(entity) });
  }
  const byId = new Map(pending.map((placing) => [placing.item.id, placing.item]));
  const issues: PackIssue[] = [];
  const placed: Item[] = [];
  const placedIds = new Set<string>();
  // The first pending item that is not in a container, or whose container is placed.
  const placeable = (): number =>
    pending.findIndex(
      ({ item }) => item.location.type !== 'contained' || placedIds.has(item.location.containerId),
    );
  for (let index = placeable(); index !== -1; index = placeable()) {
    const [next] = pending.splice(index, 1);
    if (next === undefined) break;
    const { file, item } = next;
    for (const message of validateItemMove(
      item,
      item.location,
      [...placed, item],
      characters,
      slots,
      ruleset,
    )) {
      issues.push({ file, path: 'startingLocation', message });
    }
    placed.push(item);
    placedIds.add(item.id);
  }
  // What is left never found its container placed: a cycle, or a missing container above it.
  for (const { file, item } of pending) {
    const cycle = containerCycle(item, byId);
    if (cycle !== null) {
      const message = `containers form a cycle: ${cycle.join(' → ')}`;
      issues.push({ file, path: 'startingLocation.containerId', message });
    }
  }
  return issues;
}

/** Pass 3 for items. Checks needing the slot schema or ruleset are skipped without them. */
export function itemIssues(content: PackContent, defaults: PackDefaults): PackIssue[] {
  const { slots, ruleset } = defaults;
  const perItem = [...content.entities.values()].flatMap(({ file, entity }) => {
    if (entity.kind !== 'item') return [];
    return [
      ...(slots === null ? [] : slotIssues(file, entity, slots)),
      ...(ruleset === null ? [] : bonusIssues(file, entity, ruleset)),
      ...nameIssues(file, entity),
    ];
  });
  const placement =
    slots === null || ruleset === null ? [] : placementIssues(content, slots, ruleset);
  return [...perItem, ...placement];
}
