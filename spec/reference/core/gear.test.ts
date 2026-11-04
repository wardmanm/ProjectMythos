import { readFileSync } from 'node:fs';
import { RulesetSchema, SlotSchemaDefinitionSchema } from '@mythos/contracts/content';
import type { Character, Item, ItemLocation } from '@mythos/contracts';
import { appearanceOf, loadOf, validateItemMove } from './gear';
import { eq, fixturePath } from '../test-support/harness';
const ruleset = RulesetSchema.parse(JSON.parse(readFileSync(fixturePath('library/rulesets/ruleset.standard.json'), 'utf8')));
const slots = SlotSchemaDefinitionSchema.parse(JSON.parse(readFileSync(fixturePath('packs/reference/slot-schemas/slots.everyday.json'), 'utf8')));
const wren: Character = { id: 'pc.wren', kind: 'pc', name: 'Wren', aliases: [], tags: [], ageCategory: 'adult', stats: { str: 2, end: 3, dex: 3, int: 3, cha: 2 },
  statuses: [{ id: 's1', name: 'Split Lip', kind: 'harm', level: 1, tags: ['physical'], permanent: false, treated: false, inflictedAt: 0, changedAt: 0 },
    { id: 's2', name: 'Shaken', kind: 'harm', level: 1, tags: ['mental'], permanent: false, treated: false, inflictedAt: 0, changedAt: 0 }],
  physicalDescription: 'Slight, freckled, rain-soaked.', personality: '', goals: [], keyNpc: false, locationId: 'place.harbor', lifeState: 'alive' };
const item = (id: string, name: string, location: ItemLocation, extra: Partial<Item> = {}): Item =>
  ({ id, kind: 'item', name, aliases: [], tags: [], description: '', location, ownerId: 'pc.wren', quantity: 1, bonuses: [], ...extra });
const worn = (slot: string, layer: number): ItemLocation => ({ type: 'worn', characterId: 'pc.wren', slot, layer });
const items: Item[] = [
  item('item.cloak', 'long oilskin cloak', worn('torso', 0), { wearable: { slots: ['torso'], covers: ['neck'] }, size: 'large' }),
  item('item.shirt', 'linen shirt', worn('torso', 1), { wearable: { slots: ['torso'], covers: [] }, size: 'small' }),
  item('item.trousers', 'wool trousers', worn('legs', 0), { wearable: { slots: ['legs'], covers: [] }, size: 'medium', container: { capacity: 2, maxItemSize: 'small' } }),
  item('item.fishing-knife', 'fishing knife', worn('legs', 1), { wearable: { slots: ['legs'], covers: [] }, size: 'small' }),
  item('item.boots', 'boots', worn('feet', 0), { wearable: { slots: ['feet'], covers: [] }, size: 'medium' }),
  item('item.locket', "silver locket", worn('neck', 0), { wearable: { slots: ['neck'], covers: [] }, size: 'tiny' }),
  item('item.lantern', 'lantern', { type: 'held', characterId: 'pc.wren' }, { size: 'small' }),
  item('item.coins', 'coins', { type: 'contained', containerId: 'item.trousers' }, { size: 'tiny', quantity: 1 }),
];
const a = appearanceOf(wren, items, slots, ruleset);
eq('appearance: visible layers only, cloak hides the locket, visible harm only',
  a.text, 'Slight, freckled, rain-soaked. Wearing: long oilskin cloak, wool trousers, boots. Holding: lantern. Visibly hurt: split lip.');
eq('concealed: undershirt, knife, covered locket, pocketed coins', a.concealedItemIds.sort(), ['item.coins', 'item.fishing-knife', 'item.locket', 'item.shirt']);

const chars = { 'pc.wren': wren };
const v = (it: Item, to: ItemLocation, all = items) => validateItemMove(it, to, all, chars, slots, ruleset).map((i) => i.message);
const pocket: ItemLocation = { type: 'contained', containerId: 'item.trousers' };
eq('a tiny ring fits in the pocket beside the coins', v(item('item.ring', 'ring', { type: 'gone' }, { size: 'tiny' }), pocket), []);
eq('a small knife does not fit: coins take 1 of 2', v(item('item.dagger', 'dagger', { type: 'gone' }, { size: 'small' }), pocket), ['wool trousers has room for 1 more; dagger needs 2']);
eq('a sword is too big for a pocket', v(item('item.sword', 'short sword', { type: 'gone' }, { size: 'medium' }), pocket),
  ['short sword is too big for wool trousers', 'wool trousers has room for 1 more; short sword needs 4']);
const potions = item('item.potions', 'healing draught', { type: 'gone' }, { size: 'small', quantity: 15 });
const pack = item('item.pack', 'canvas pack', worn('torso', 0), { container: { capacity: 16, maxItemSize: 'medium' }, size: 'large' });
eq('15 potions need 30 points: a 16-point pack refuses', v(potions, { type: 'contained', containerId: 'item.pack' }, [...items, pack]), ['canvas pack has room for 16 more; healing draught needs 30']);
eq('carried is not allowed in containers mode', v(potions, { type: 'carried', characterId: 'pc.wren' }), ['this ruleset carries in containers: put it in something, hold it, or wear it']);
eq('a second held item is fine', v(item('item.sword', 'short sword', { type: 'gone' }, { size: 'medium' }), { type: 'held', characterId: 'pc.wren' }), []);
eq('a large oar needs two hands', v(item('item.oar', 'oar', { type: 'gone' }, { size: 'large' }), { type: 'held', characterId: 'pc.wren' }), ['Wren has no free hands (it needs two)']);
eq('a shirt cannot go on the feet, and feet have one layer', v(items[1]!, worn('feet', 1)), ['linen shirt cannot be worn on the feet', 'the feet has no layer 1']);
eq('one item per layer: the outer torso is taken', v(item('item.coat', 'coat', { type: 'gone' }, { wearable: { slots: ['torso'], covers: [] } }), worn('torso', 0)), ['already wearing long oilskin cloak there']);
const bagA = item('item.bag-a', 'bag A', { type: 'contained', containerId: 'item.bag-b' }, { size: 'small', container: { capacity: 8, maxItemSize: 'small' } });
const bagB = item('item.bag-b', 'bag B', { type: 'held', characterId: 'pc.wren' }, { size: 'small', container: { capacity: 8, maxItemSize: 'small' } });
eq('no container inside itself, however deep', v(bagB, { type: 'contained', containerId: 'item.bag-a' }, [bagA, bagB]), ['bag B cannot go inside itself']);

// encumbrance variant
const enc = RulesetSchema.parse({ ...ruleset, carrying: { mode: 'encumbrance', baseCapacity: 10, capacityPerPoint: 5, capacityStat: 'str', encumberedStatus: 'Encumbered', hardLimitMultiplier: 2 } });
const swords = item('item.swords', 'short swords', { type: 'gone' }, { weight: 3, quantity: 15 });
eq('encumbrance: load and capacity (10 + 5 × STR 2)', loadOf('pc.wren', [item('item.rope', 'rope', { type: 'carried', characterId: 'pc.wren' }, { weight: 4 })], wren, enc), { load: 4, capacity: 20 });
eq('15 swords (45) exceed twice capacity (40): refused', validateItemMove(swords, { type: 'carried', characterId: 'pc.wren' }, [], chars, slots, enc).map((i) => i.message), ['too heavy: Wren cannot carry that much']);
eq('6 swords (18) are fine: magic-pocket style', validateItemMove({ ...swords, quantity: 6 }, { type: 'carried', characterId: 'pc.wren' }, [], chars, slots, enc), []);
