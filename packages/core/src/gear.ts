// Gear (11-gear §3 to §5): who has each item, and whether an item move is legal under the
// slot schema and the ruleset's carrying rules. Appearance is in gear-appearance.ts.
import { type Character, type Item, type ItemLocation, ItemSizeSchema } from '@mythos/contracts';
import type { Ruleset, SlotSchemaDefinition } from '@mythos/contracts/content';

type WornLocation = Extract<ItemLocation, { type: 'worn' }>;
type EncumbranceRules = Extract<Ruleset['carrying'], { mode: 'encumbrance' }>;

const SIZES = ItemSizeSchema.options;

/** Large and huge items take two hands (GEAR-004) and show when carried (GEAR-060). */
export function isBulky(item: Item): boolean {
  return item.size === 'large' || item.size === 'huge';
}

/** Items keyed by ID, for following containers. */
export function indexById(items: readonly Item[]): Record<string, Item> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

/**
 * The character who has an item on them: its wearer, holder, or carrier, following
 * containers outward. Null when it is placed, gone, or in a missing container or a
 * containment cycle. Implements GEAR-010 and GEAR-011.
 */
export function possessor(item: Item, itemsById: Readonly<Record<string, Item>>): string | null {
  const seen = new Set<string>();
  let current: Item | undefined = item;
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    const location: ItemLocation = current.location;
    switch (location.type) {
      case 'worn':
      case 'held':
      case 'carried':
        return location.characterId;
      case 'contained':
        current = itemsById[location.containerId];
        break;
      case 'placed':
      case 'gone':
        return null;
    }
  }
  return null;
}

/**
 * Size points used inside a container: each item's size points times its quantity.
 * Always 0 outside containers mode. Implements GEAR-041.
 */
export function containerUse(
  containerId: string,
  items: readonly Item[],
  ruleset: Ruleset,
  ignoreId?: string,
): number {
  const carrying = ruleset.carrying;
  if (carrying.mode !== 'containers') return 0;
  return items
    .filter(
      (item) =>
        item.id !== ignoreId &&
        item.location.type === 'contained' &&
        item.location.containerId === containerId,
    )
    .reduce(
      (sum, item) => sum + (item.size ? carrying.sizePoints[item.size] : 0) * item.quantity,
      0,
    );
}

/** Total weight, times quantity, of everything the character possesses. Implements GEAR-050. */
function weightOn(characterId: string, items: readonly Item[]): number {
  const itemsById = indexById(items);
  return items
    .filter((item) => possessor(item, itemsById) === characterId)
    .reduce((sum, item) => sum + (item.weight ?? 0) * item.quantity, 0);
}

/** Implements GEAR-051. */
function capacityOf(character: Character, carrying: EncumbranceRules): number {
  const rating = character.stats[carrying.capacityStat] ?? 0;
  return carrying.baseCapacity + carrying.capacityPerPoint * rating;
}

/**
 * A character's load and capacity in encumbrance mode, worn and contained items
 * included; null in containers mode. Implements GEAR-050 and GEAR-051.
 */
export function loadOf(
  character: Character,
  items: readonly Item[],
  ruleset: Ruleset,
): { load: number; capacity: number } | null {
  const carrying = ruleset.carrying;
  if (carrying.mode !== 'encumbrance') return null;
  return { load: weightOn(character.id, items), capacity: capacityOf(character, carrying) };
}

function heldIssues(
  item: Item,
  characterId: string,
  others: Item[],
  characters: Readonly<Record<string, Character>>,
  slots: SlotSchemaDefinition,
): string[] {
  // Implements GEAR-004: heldItems is the number of free hands.
  const hands = (held: Item): number => (isBulky(held) ? 2 : 1);
  const used = others
    .filter((other) => other.location.type === 'held' && other.location.characterId === characterId)
    .reduce((sum, other) => sum + hands(other), 0);
  if (used + hands(item) <= slots.heldItems) return [];
  const name = characters[characterId]?.name ?? characterId;
  return [isBulky(item) ? `${name} has no free hands (it needs two)` : `${name} has no free hand`];
}

function wornIssues(
  item: Item,
  to: WornLocation,
  others: Item[],
  slots: SlotSchemaDefinition,
): string[] {
  // Implements GEAR-002: a wearable slot, a layer that exists, and room in it.
  const slot = slots.slots.find((candidate) => candidate.id === to.slot);
  if (slot === undefined) return [`there is no "${to.slot}" slot`];
  const issues: string[] = [];
  const slotName = slot.name.toLowerCase();
  if (!(item.wearable?.slots.includes(to.slot) ?? false)) {
    issues.push(`${item.name} cannot be worn on the ${slotName}`);
  }
  if (to.layer >= slot.layers.length) {
    const count = slot.layers.length;
    issues.push(`the ${slotName} slot has only ${String(count)} layer${count === 1 ? '' : 's'}`);
  }
  const sameLayer = others.filter(
    (other) =>
      other.location.type === 'worn' &&
      other.location.characterId === to.characterId &&
      other.location.slot === to.slot &&
      other.location.layer === to.layer,
  );
  if (sameLayer.length >= slot.itemsPerLayer) {
    issues.push(`already wearing ${sameLayer.map((other) => other.name).join(', ')} there`);
  }
  return issues;
}

/** Whether `container` is the item itself or sits inside it, however deeply. */
function isWithin(container: Item, itemId: string, itemsById: Record<string, Item>): boolean {
  const seen = new Set<string>();
  let current: Item | undefined = container;
  while (current !== undefined && !seen.has(current.id)) {
    if (current.id === itemId) return true;
    seen.add(current.id);
    current =
      current.location.type === 'contained' ? itemsById[current.location.containerId] : undefined;
  }
  return false;
}

function containedIssues(
  item: Item,
  containerId: string,
  items: readonly Item[],
  ruleset: Ruleset,
): string[] {
  const itemsById = indexById(items);
  const box = itemsById[containerId];
  if (box === undefined) return [`there is no "${containerId}" to put it in`];
  if (box.container === undefined) return [`${box.name} cannot hold things`];
  const issues: string[] = [];
  if (isWithin(box, item.id, itemsById)) issues.push(`${item.name} cannot go inside itself`);

  const carrying = ruleset.carrying;
  if (carrying.mode !== 'containers') return issues;
  // Implements GEAR-043: in containers mode, an item needs a size to fit anywhere.
  if (item.size === undefined) {
    return [...issues, `${item.name} has no size, so it cannot be fitted into a container`];
  }
  if (SIZES.indexOf(item.size) > SIZES.indexOf(box.container.maxItemSize)) {
    issues.push(`${item.name} is too big for ${box.name}`);
  }
  const need = carrying.sizePoints[item.size] * item.quantity;
  const used = containerUse(box.id, items, ruleset, item.id);
  if (used + need > box.container.capacity) {
    const room = Math.max(0, box.container.capacity - used);
    issues.push(
      `${box.name} has room for ${String(room)} more; ${item.name} needs ${String(need)}`,
    );
  }
  return issues;
}

/**
 * The hard limit applies to whoever has the item after the move, and counts everything
 * inside it, so a full pack weighs what it holds. Implements GEAR-052.
 */
function hardLimitIssues(
  item: Item,
  to: ItemLocation,
  items: readonly Item[],
  characters: Readonly<Record<string, Character>>,
  ruleset: Ruleset,
): string[] {
  const carrying = ruleset.carrying;
  if (carrying.mode !== 'encumbrance' || carrying.hardLimitMultiplier === null) return [];
  const moved: Item = { ...item, location: to };
  const after = [...items.filter((other) => other.id !== item.id), moved];
  const holderId = possessor(moved, indexById(after));
  const holder = holderId === null ? undefined : characters[holderId];
  if (holder === undefined) return [];
  const limit = capacityOf(holder, carrying) * carrying.hardLimitMultiplier;
  if (weightOn(holder.id, after) <= limit) return [];
  return [`too heavy: ${holder.name} cannot carry that much`];
}

/**
 * Every reason moving `item` to `to` is illegal, in plain English; empty when the move is
 * fine. `items` is every item in play, which may include `item` at its current location.
 * Characters and places named by `to` must already be known to exist (commit validation
 * checks references). Implements GEAR-040, GEAR-041, GEAR-042, GEAR-043, GEAR-052, and
 * GEAR-053.
 */
export function validateItemMove(
  item: Item,
  to: ItemLocation,
  items: readonly Item[],
  characters: Readonly<Record<string, Character>>,
  slots: SlotSchemaDefinition,
  ruleset: Ruleset,
): string[] {
  const others = items.filter((other) => other.id !== item.id && other.location.type !== 'gone');
  const issues: string[] = [];
  switch (to.type) {
    case 'placed':
    case 'gone':
      break;
    case 'carried':
      // Implements GEAR-040: containers mode has no "carried".
      if (ruleset.carrying.mode !== 'encumbrance') {
        issues.push('this ruleset carries in containers: put it in something, hold it, or wear it');
      }
      break;
    case 'held':
      issues.push(...heldIssues(item, to.characterId, others, characters, slots));
      break;
    case 'worn':
      issues.push(...wornIssues(item, to, others, slots));
      break;
    case 'contained':
      issues.push(...containedIssues(item, to.containerId, items, ruleset));
      break;
  }
  issues.push(...hardLimitIssues(item, to, items, characters, ruleset));
  return issues;
}
