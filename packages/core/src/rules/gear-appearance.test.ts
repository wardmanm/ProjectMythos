import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Character,
  CharacterSchema,
  type Item,
  type ItemLocation,
  ItemSchema,
} from '@mythos/contracts';
import {
  AuthoredCharacterSchema,
  AuthoredItemSchema,
  type Ruleset,
  RulesetSchema,
  SlotSchemaDefinitionSchema,
} from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { appearanceOf } from './gear-appearance';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const packDir = path.join(repoRoot, 'content-packs/reference');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

const ruleset = RulesetSchema.parse(
  readJson(path.join(repoRoot, 'content-library/rulesets/ruleset.standard.json')),
);
const slots = SlotSchemaDefinitionSchema.parse(
  readJson(path.join(packDir, 'slot-schemas/slots.everyday.json')),
);
const encumbrance: Ruleset = {
  ...ruleset,
  carrying: {
    mode: 'encumbrance',
    baseCapacity: 10,
    capacityPerPoint: 5,
    capacityStat: 'str',
    encumberedStatus: 'Encumbered',
    hardLimitMultiplier: null,
  },
};

const wren: Character = {
  id: 'pc.wren',
  kind: 'pc',
  name: 'Wren',
  aliases: [],
  tags: [],
  ageCategory: 'adult',
  stats: { str: 2, end: 3, dex: 3, int: 3, cha: 2 },
  statuses: [
    {
      id: 's1',
      name: 'Split Lip',
      kind: 'harm',
      level: 1,
      tags: ['physical'],
      permanent: false,
      treated: false,
      inflictedAt: 0,
      changedAt: 0,
    },
    {
      id: 's2',
      name: 'Shaken',
      kind: 'harm',
      level: 1,
      tags: ['mental'],
      permanent: false,
      treated: false,
      inflictedAt: 0,
      changedAt: 0,
    },
  ],
  physicalDescription: 'Slight, freckled, rain-soaked. ',
  personality: '',
  goals: [],
  keyNpc: false,
  locationId: 'place.harbor',
  lifeState: 'alive',
};
const item = (
  id: string,
  name: string,
  location: ItemLocation,
  extra: Partial<Item> = {},
): Item => ({
  id,
  kind: 'item',
  name,
  aliases: [],
  tags: [],
  description: '',
  location,
  ownerId: 'pc.wren',
  quantity: 1,
  bonuses: [],
  ...extra,
});
const worn = (slot: string, layer: number): ItemLocation => ({
  type: 'worn',
  characterId: 'pc.wren',
  slot,
  layer,
});
const nowhere: ItemLocation = { type: 'gone' };
const held: ItemLocation = { type: 'held', characterId: 'pc.wren' };
const carried: ItemLocation = { type: 'carried', characterId: 'pc.wren' };
const wearable = (slot: string, covers: string[] = []) => ({ wearable: { slots: [slot], covers } });

const items: Item[] = [
  item('item.cloak', 'long oilskin cloak', worn('torso', 0), {
    ...wearable('torso', ['neck']),
    size: 'large',
  }),
  item('item.shirt', 'linen shirt', worn('torso', 1), { ...wearable('torso'), size: 'small' }),
  item('item.trousers', 'wool trousers', worn('legs', 0), {
    ...wearable('legs'),
    size: 'medium',
    container: { capacity: 2, maxItemSize: 'small' },
  }),
  item('item.fishing-knife', 'fishing knife', worn('legs', 1), {
    ...wearable('legs'),
    size: 'small',
  }),
  item('item.boots', 'boots', worn('feet', 0), { ...wearable('feet'), size: 'medium' }),
  item('item.locket', 'silver locket', worn('neck', 0), { ...wearable('neck'), size: 'tiny' }),
  item('item.lantern', 'lantern', held, { size: 'small' }),
  item(
    'item.coins',
    'coins',
    { type: 'contained', containerId: 'item.trousers' },
    { size: 'tiny' },
  ),
];
describe('appearance', () => {
  const appearance = appearanceOf(wren, items, slots, ruleset);

  it('GEAR-060, GEAR-061, GEAR-062: visible layers in slot order, held items, and visible harm only', () => {
    expect(appearance.text).toBe(
      'Slight, freckled, rain-soaked. Wearing: long oilskin cloak, wool trousers, boots. ' +
        'Holding: lantern. Visibly hurt: split lip.',
    );
    expect(appearance.visibleItemIds).toEqual([
      'item.cloak',
      'item.trousers',
      'item.boots',
      'item.lantern',
    ]);
  });

  it('GEAR-030: concealed are the under layers, the covered locket, and the pocketed coins', () => {
    expect(appearance.concealedItemIds).toEqual([
      'item.coins',
      'item.fishing-knife',
      'item.locket',
      'item.shirt',
    ]);
  });

  it('GEAR-030, GEAR-060: in encumbrance mode, bulky carried items show and small ones are concealed', () => {
    const withLoad = [
      ...items,
      item('item.oar', 'oar', carried, { size: 'large' }),
      item('item.rope', 'rope', carried, { size: 'small' }),
    ];
    const result = appearanceOf(wren, withLoad, slots, encumbrance);
    expect(result.text).toContain('Holding: lantern. Carrying: oar. Visibly hurt');
    expect(result.concealedItemIds).toContain('item.rope');
    expect(result.visibleItemIds).toContain('item.oar');
  });

  it('GEAR-062, GEAR-065: a stack shows its quantity, and names are used as written', () => {
    const torches = item('item.torch', 'torch', held, { quantity: 3 });
    const letter = item('item.letter', "Jory's letter", held);
    const plain: Character = { ...wren, statuses: [], physicalDescription: 'Tall.' };
    expect(appearanceOf(plain, [torches, letter], slots, ruleset).text).toBe(
      "Tall. Holding: Jory's letter, torch (3).",
    );
  });

  it('GEAR-060: other characters’ items and gone items are not part of her appearance', () => {
    const others = [
      item('item.hat', 'hat', { type: 'worn', characterId: 'npc.odette', slot: 'head', layer: 0 }),
      item('item.apple', 'apple', nowhere),
    ];
    const plain: Character = { ...wren, statuses: [] };
    expect(appearanceOf(plain, others, slots, ruleset)).toEqual({
      text: 'Slight, freckled, rain-soaked.',
      visibleItemIds: [],
      concealedItemIds: [],
    });
  });

  it('GEAR-062, GEAR-065: Wren’s appearance from the reference pack', () => {
    const itemsDir = path.join(packDir, 'entities/items');
    const packItems = readdirSync(itemsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => {
        const authored = AuthoredItemSchema.parse(readJson(path.join(itemsDir, file)));
        return ItemSchema.parse({ ...authored, location: authored.startingLocation });
      });
    const authoredWren = AuthoredCharacterSchema.parse(
      readJson(path.join(packDir, 'entities/characters/pc.wren.json')),
    );
    const packWren = CharacterSchema.parse({
      ...authoredWren,
      statuses: [],
      locationId: authoredWren.startingLocationId,
      lifeState: 'alive',
    });
    expect(appearanceOf(packWren, packItems, slots, ruleset).text).toBe(
      'Slight and freckled, with dark hair cropped short and a watchful look. ' +
        'Wearing: oilskin cloak, wool trousers, boots. Holding: carpetbag.',
    );
  });
});
