import { cmp } from './compare';
import type { Character, Item, ItemLocation, ItemSize, Status } from '@mythos/contracts';
import type { Ruleset, SlotSchemaDefinition } from '@mythos/contracts/content';

export type GearIssue = { message: string };
const SIZES: ItemSize[] = ['tiny', 'small', 'medium', 'large', 'huge'];
const big = (i: Item) => i.size === 'large' || i.size === 'huge';

/** The character who has an item on them, following containers (GEAR-011). */
export function possessor(item: Item, items: Record<string, Item>, seen = new Set<string>()): string | null {
  const l = item.location;
  if (l.type === 'worn' || l.type === 'held' || l.type === 'carried') return l.characterId;
  if (l.type !== 'contained' || seen.has(item.id)) return null;
  seen.add(item.id);
  const c = items[l.containerId];
  return c ? possessor(c, items, seen) : null;
}

// ================================================================ appearance (GEAR §3)

export function appearanceOf(ch: Character, items: Item[], slots: SlotSchemaDefinition, ruleset: Ruleset) {
  const mine = items.filter((i) => i.location.type !== 'gone' && 'characterId' in i.location && i.location.characterId === ch.id);
  const worn = mine.filter((i): i is Item & { location: Extract<ItemLocation, { type: 'worn' }> } => i.location.type === 'worn');
  const covered = new Set(worn.flatMap((i) => i.wearable?.covers ?? []));
  const visibleWorn: Item[] = [];
  for (const slot of slots.slots) {
    if (covered.has(slot.id)) continue;
    slot.layers.forEach((layer, index) => {
      if (layer.visibility !== 'visible') return;
      visibleWorn.push(...worn.filter((i) => i.location.slot === slot.id && i.location.layer === index).sort((a, b) => cmp(a.id, b.id)));
    });
  }
  const held = mine.filter((i) => i.location.type === 'held').sort((a, b) => cmp(a.id, b.id));
  const bulky = mine.filter((i) => i.location.type === 'carried' && big(i)).sort((a, b) => cmp(a.id, b.id));
  const visibleIds = new Set([...visibleWorn, ...held, ...bulky].map((i) => i.id));
  const visibleTags = new Set(ruleset.harm.tags.filter((t) => t.visible).map((t) => t.id));
  const visibleStatuses = ch.statuses.filter((s: Status) => s.kind === 'harm' && s.tags.some((t) => visibleTags.has(t)));
  // A list, not prose: names are used as written (GEAR-065), so no articles to guess.
  const list = (xs: Item[]) => xs.map((i) => (i.quantity > 1 ? `${i.name} (${i.quantity})` : i.name)).join(', ');
  const parts = [ch.physicalDescription.trim()];
  if (visibleWorn.length) parts.push(`Wearing: ${list(visibleWorn)}.`);
  if (held.length) parts.push(`Holding: ${list(held)}.`);
  if (bulky.length) parts.push(`Carrying: ${list(bulky)}.`);
  if (visibleStatuses.length) parts.push(`Visibly hurt: ${visibleStatuses.map((s) => s.name.toLowerCase()).join(', ')}.`);
  return {
    text: parts.filter(Boolean).join(' '),
    visibleItemIds: [...visibleIds],
    concealedItemIds: items.filter((i) => i.location.type !== 'gone' && !visibleIds.has(i.id) && possessor(i, Object.fromEntries(items.map((x) => [x.id, x]))) === ch.id).map((i) => i.id),
  };
}

// ================================================================ carrying (GEAR §5)

export function containerUse(containerId: string, items: Item[], ruleset: Ruleset, ignoreId?: string): number {
  if (ruleset.carrying.mode !== 'containers') return 0;
  const pts = ruleset.carrying.sizePoints;
  return items
    .filter((i) => i.id !== ignoreId && i.location.type === 'contained' && i.location.containerId === containerId)
    .reduce((a, i) => a + (i.size ? pts[i.size] : 0) * i.quantity, 0);
}

export function loadOf(characterId: string, items: Item[], ch: Character, ruleset: Ruleset) {
  if (ruleset.carrying.mode !== 'encumbrance') return null;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const load = items.filter((i) => i.location.type !== 'gone' && possessor(i, byId) === characterId).reduce((a, i) => a + (i.weight ?? 0) * i.quantity, 0);
  const c = ruleset.carrying;
  return { load, capacity: c.baseCapacity + c.capacityPerPoint * (ch.stats[c.capacityStat] ?? 0) };
}

/** Every reason a move is illegal; empty when it is fine (GEAR-040). */
export function validateItemMove(item: Item, to: ItemLocation, items: Item[], characters: Record<string, Character>, slots: SlotSchemaDefinition, ruleset: Ruleset): GearIssue[] {
  const issues: GearIssue[] = [];
  const say = (message: string) => issues.push({ message });
  const others = items.filter((i) => i.id !== item.id && i.location.type !== 'gone');
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  switch (to.type) {
    case 'gone': case 'placed': break;
    case 'carried':
      if (ruleset.carrying.mode !== 'encumbrance') say('this ruleset carries in containers: put it in something, hold it, or wear it');
      break;
    case 'held': {
      const hands = others.filter((i) => i.location.type === 'held' && i.location.characterId === to.characterId).reduce((a, i) => a + (big(i) ? 2 : 1), 0);
      if (hands + (big(item) ? 2 : 1) > slots.heldItems) say(`${characters[to.characterId]?.name ?? to.characterId} has no free hand${big(item) ? 's (it needs two)' : ''}`);
      break;
    }
    case 'worn': {
      const slot = slots.slots.find((s) => s.id === to.slot);
      if (!slot) { say(`there is no "${to.slot}" slot`); break; }
      if (!item.wearable?.slots.includes(to.slot)) say(`${item.name} cannot be worn on the ${slot.name.toLowerCase()}`);
      if (to.layer >= slot.layers.length) say(`the ${slot.name.toLowerCase()} has no layer ${to.layer}`);
      const sameLayer = others.filter((i) => i.location.type === 'worn' && i.location.characterId === to.characterId && i.location.slot === to.slot && i.location.layer === to.layer);
      if (sameLayer.length >= slot.itemsPerLayer) say(`already wearing ${sameLayer.map((i) => i.name).join(', ')} there`);
      break;
    }
    case 'contained': {
      const box = byId[to.containerId];
      if (!box?.container) { say(`${box?.name ?? to.containerId} cannot hold things`); break; }
      for (let c: Item | undefined = box; c; c = c.location.type === 'contained' ? byId[c.location.containerId] : undefined) {
        if (c.id === item.id) { say(`${item.name} cannot go inside itself`); break; }
      }
      if (ruleset.carrying.mode === 'containers') {
        if (!item.size) { say(`${item.name} has no size, so it cannot be fitted into a container`); break; }
        if (SIZES.indexOf(item.size) > SIZES.indexOf(box.container.maxItemSize)) say(`${item.name} is too big for ${box.name}`);
        const need = ruleset.carrying.sizePoints[item.size] * item.quantity;
        const used = containerUse(box.id, items, ruleset, item.id);
        if (used + need > box.container.capacity) say(`${box.name} has room for ${box.container.capacity - used} more; ${item.name} needs ${need}`);
      }
      break;
    }
  }
  // Encumbrance hard limit applies to whoever ends up with it (GEAR-052).
  const c = ruleset.carrying;
  const holderId = to.type === 'contained' ? possessor(byId[to.containerId] as Item, byId) : 'characterId' in to ? to.characterId : null;
  if (c.mode === 'encumbrance' && c.hardLimitMultiplier !== null && holderId && characters[holderId]) {
    const before = loadOf(holderId, others, characters[holderId] as Character, ruleset);
    if (before && before.load + (item.weight ?? 0) * item.quantity > before.capacity * c.hardLimitMultiplier) say(`too heavy: ${characters[holderId]?.name} cannot carry that much`);
  }
  return issues;
}
