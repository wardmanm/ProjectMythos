// Appearance (11-gear §6): what others can see of a character, built by code from their
// description, visible gear, and visible harm, plus the items they cannot see.
import type { Character, Item } from '@mythos/contracts';
import type { Ruleset, SlotSchemaDefinition } from '@mythos/contracts/content';
import { cmp } from '../compare';
import { indexById, isBulky, possessor } from './gear';

/** What others can see of a character, and which of their items are hidden from them. */
export type Appearance = {
  text: string;
  visibleItemIds: string[];
  concealedItemIds: string[];
};

function sortById(items: Item[]): Item[] {
  return items.sort((a, b) => cmp(a.id, b.id));
}

/** Whether the item is worn, held, or carried by this character directly, not in a container. */
function isOnBody(item: Item, characterId: string): boolean {
  const location = item.location;
  return (
    (location.type === 'worn' || location.type === 'held' || location.type === 'carried') &&
    location.characterId === characterId
  );
}

/** Visible worn items in slot-schema order, outermost layer first, skipping covered slots. */
function visibleWornItems(worn: Item[], slots: SlotSchemaDefinition): Item[] {
  // Implements GEAR-003: a worn item hides everything in the slots it covers.
  const covered = new Set(worn.flatMap((item) => item.wearable?.covers ?? []));
  const visible: Item[] = [];
  for (const slot of slots.slots) {
    if (covered.has(slot.id)) continue;
    slot.layers.forEach((layer, index) => {
      if (layer.visibility !== 'visible') return;
      const here = worn.filter(
        (item) =>
          item.location.type === 'worn' &&
          item.location.slot === slot.id &&
          item.location.layer === index,
      );
      visible.push(...sortById(here));
    });
  }
  return visible;
}

/** Item names as written (GEAR-065), with a stack's quantity: "torch (3)". */
function nameList(items: Item[]): string {
  return items
    .map((item) => (item.quantity > 1 ? `${item.name} (${String(item.quantity)})` : item.name))
    .join(', ');
}

/**
 * A character's appearance, built deterministically: physical description, visible worn
 * items, held items, bulky carried items, and visible harm; plus the items others cannot
 * see. Implements GEAR-030, GEAR-060, GEAR-061, GEAR-062, and GEAR-065.
 */
export function appearanceOf(
  character: Character,
  items: readonly Item[],
  slots: SlotSchemaDefinition,
  ruleset: Ruleset,
): Appearance {
  const onBody = items.filter((item) => isOnBody(item, character.id));
  const worn = visibleWornItems(
    onBody.filter((item) => item.location.type === 'worn'),
    slots,
  );
  const held = sortById(onBody.filter((item) => item.location.type === 'held'));
  const bulky = sortById(
    onBody.filter((item) => item.location.type === 'carried' && isBulky(item)),
  );
  const visibleIds = new Set([...worn, ...held, ...bulky].map((item) => item.id));

  const visibleTags = new Set(ruleset.harm.tags.filter((tag) => tag.visible).map((tag) => tag.id));
  const visibleHarm = character.statuses.filter(
    (status) => status.kind === 'harm' && status.tags.some((tag) => visibleTags.has(tag)),
  );

  // A list, not prose: names are used as written (GEAR-065), so there are no articles to guess.
  const parts = [character.physicalDescription.trim()];
  if (worn.length > 0) parts.push(`Wearing: ${nameList(worn)}.`);
  if (held.length > 0) parts.push(`Holding: ${nameList(held)}.`);
  if (bulky.length > 0) parts.push(`Carrying: ${nameList(bulky)}.`);
  if (visibleHarm.length > 0) {
    const names = visibleHarm.map((status) => status.name.toLowerCase());
    parts.push(`Visibly hurt: ${names.join(', ')}.`);
  }

  const itemsById = indexById(items);
  const concealedItemIds = items
    .filter((item) => !visibleIds.has(item.id) && possessor(item, itemsById) === character.id)
    .map((item) => item.id)
    .sort(cmp);
  return {
    text: parts.filter((part) => part !== '').join(' '),
    visibleItemIds: [...visibleIds],
    concealedItemIds,
  };
}
