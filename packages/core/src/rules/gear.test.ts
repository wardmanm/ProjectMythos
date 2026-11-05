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
import { containerUse, loadOf, possessor, validateItemMove } from './gear';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const packDir = path.join(repoRoot, 'content-packs/reference');
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

const ruleset = RulesetSchema.parse(
  readJson(path.join(repoRoot, 'content-library/rulesets/ruleset.standard.json')),
);
const slots = SlotSchemaDefinitionSchema.parse(
  readJson(path.join(packDir, 'slot-schemas/slots.everyday.json')),
);
const encumbranceRules = (hardLimitMultiplier: number | null): Ruleset => ({
  ...ruleset,
  carrying: {
    mode: 'encumbrance',
    baseCapacity: 10,
    capacityPerPoint: 5,
    capacityStat: 'str',
    encumberedStatus: 'Encumbered',
    hardLimitMultiplier,
  },
});
const encumbrance = encumbranceRules(2);

const wren: Character = {
  id: 'pc.wren',
  kind: 'pc',
  name: 'Wren',
  aliases: [],
  tags: [],
  ageCategory: 'adult',
  stats: { str: 2, end: 3, dex: 3, int: 3, cha: 2 },
  statuses: [],
  physicalDescription: 'Slight, freckled, rain-soaked.',
  personality: '',
  goals: [],
  keyNpc: false,
  locationId: 'place.harbor',
  lifeState: 'alive',
};
const characters = { 'pc.wren': wren };

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
const pocket: ItemLocation = { type: 'contained', containerId: 'item.trousers' };
const move = (moved: Item, to: ItemLocation, all: Item[] = items, rules: Ruleset = ruleset) =>
  validateItemMove(moved, to, all, characters, slots, rules);

describe('possessor', () => {
  const purse = item('item.purse', 'purse', { type: 'contained', containerId: 'item.pack' });
  const pack = item('item.pack', 'canvas pack', worn('torso', 0));
  const coin = item('item.coin', 'coin', { type: 'contained', containerId: 'item.purse' });
  const byId = { 'item.purse': purse, 'item.pack': pack, 'item.coin': coin };

  it('GEAR-011: a coin in a purse in a pack worn by Wren is Wren’s', () => {
    expect(possessor(coin, byId)).toBe('pc.wren');
  });

  it('GEAR-010: worn, held, and carried items are with their character; placed and gone ones with nobody', () => {
    expect(possessor(item('a', 'a', held), {})).toBe('pc.wren');
    expect(possessor(item('a', 'a', carried), {})).toBe('pc.wren');
    expect(possessor(item('a', 'a', { type: 'placed', placeId: 'place.harbor' }), {})).toBeNull();
    expect(possessor(item('a', 'a', nowhere), {})).toBeNull();
  });

  it('GEAR-011: a missing container or a containment cycle has no possessor', () => {
    expect(possessor(coin, { 'item.coin': coin })).toBeNull();
    const a = item('item.a', 'a', { type: 'contained', containerId: 'item.b' });
    const b = item('item.b', 'b', { type: 'contained', containerId: 'item.a' });
    expect(possessor(a, { 'item.a': a, 'item.b': b })).toBeNull();
  });
});

describe('containers mode', () => {
  it('GEAR-040: carried is not allowed', () => {
    expect(move(item('item.rope', 'rope', nowhere, { size: 'small' }), carried)).toEqual([
      'this ruleset carries in containers: put it in something, hold it, or wear it',
    ]);
  });

  it('GEAR-041, GEAR-042: a tiny ring fits in the pocket beside the coins', () => {
    expect(move(item('item.ring', 'ring', nowhere, { size: 'tiny' }), pocket)).toEqual([]);
  });

  it('GEAR-041, GEAR-042, GEAR-053: a small dagger does not fit, since the coins take 1 of 2', () => {
    expect(move(item('item.dagger', 'dagger', nowhere, { size: 'small' }), pocket)).toEqual([
      'wool trousers has room for 1 more; dagger needs 2',
    ]);
  });

  it('GEAR-042: an empty pocket holds a knife but never a sword', () => {
    const empty = items.filter((other) => other.id !== 'item.coins');
    expect(move(item('item.knife', 'knife', nowhere, { size: 'small' }), pocket, empty)).toEqual(
      [],
    );
    expect(
      move(item('item.sword', 'short sword', nowhere, { size: 'medium' }), pocket, empty),
    ).toEqual([
      'short sword is too big for wool trousers',
      'wool trousers has room for 2 more; short sword needs 4',
    ]);
  });

  it('GEAR-041: fifteen potions need 30 points, so a 16-point pack refuses them', () => {
    const potions = item('item.potions', 'healing draught', nowhere, {
      size: 'small',
      quantity: 15,
    });
    const pack = item('item.pack', 'canvas pack', held, {
      size: 'large',
      container: { capacity: 16, maxItemSize: 'medium' },
    });
    const into: ItemLocation = { type: 'contained', containerId: 'item.pack' };
    expect(move(potions, into, [pack])).toEqual([
      'canvas pack has room for 16 more; healing draught needs 30',
    ]);
    expect(
      containerUse('item.pack', [pack, { ...potions, quantity: 3, location: into }], ruleset),
    ).toBe(6);
  });

  it('GEAR-043: an item without a size cannot go in a container', () => {
    expect(move(item('item.thing', 'odd thing', nowhere), pocket)).toEqual([
      'odd thing has no size, so it cannot be fitted into a container',
    ]);
  });
});

describe('every illegal move has its reason', () => {
  it('GEAR-053: a second held item is fine, but a large oar needs two free hands', () => {
    expect(move(item('item.sword', 'short sword', nowhere, { size: 'medium' }), held)).toEqual([]);
    expect(move(item('item.oar', 'oar', nowhere, { size: 'large' }), held)).toEqual([
      'Wren has no free hands (it needs two)',
    ]);
  });

  it('GEAR-053: with both hands full there is no free hand', () => {
    const full = [...items, item('item.sword', 'short sword', held, { size: 'medium' })];
    expect(move(item('item.cup', 'cup', nowhere, { size: 'tiny' }), held, full)).toEqual([
      'Wren has no free hand',
    ]);
  });

  it('GEAR-053: a shirt cannot go on the feet, and the feet have one layer', () => {
    const shirt = items[1];
    expect(shirt && move(shirt, worn('feet', 1))).toEqual([
      'linen shirt cannot be worn on the feet',
      'the feet slot has only 1 layer',
    ]);
  });

  it('GEAR-053: one item per layer, so the outer torso is taken', () => {
    expect(move(item('item.coat', 'coat', nowhere, wearable('torso')), worn('torso', 0))).toEqual([
      'already wearing long oilskin cloak there',
    ]);
  });

  it('GEAR-053: an item already in place may stay there', () => {
    const cloak = items[0];
    expect(cloak && move(cloak, cloak.location)).toEqual([]);
  });

  it('GEAR-053: a slot or a container that does not exist, and an item that holds nothing', () => {
    expect(move(item('item.hat', 'hat', nowhere, wearable('head')), worn('tail', 0))).toEqual([
      'there is no "tail" slot',
    ]);
    const box: ItemLocation = { type: 'contained', containerId: 'item.box' };
    expect(move(item('item.ring', 'ring', nowhere, { size: 'tiny' }), box)).toEqual([
      'there is no "item.box" to put it in',
    ]);
    const intoBoots: ItemLocation = { type: 'contained', containerId: 'item.boots' };
    expect(move(item('item.ring', 'ring', nowhere, { size: 'tiny' }), intoBoots)).toEqual([
      'boots cannot hold things',
    ]);
  });

  it('GEAR-053: no container goes inside itself, however deep', () => {
    const bagA = item(
      'item.bag-a',
      'bag A',
      { type: 'contained', containerId: 'item.bag-b' },
      {
        size: 'small',
        container: { capacity: 8, maxItemSize: 'small' },
      },
    );
    const bagB = item('item.bag-b', 'bag B', held, {
      size: 'small',
      container: { capacity: 8, maxItemSize: 'small' },
    });
    expect(move(bagB, { type: 'contained', containerId: 'item.bag-a' }, [bagA, bagB])).toEqual([
      'bag B cannot go inside itself',
    ]);
    expect(move(bagB, { type: 'contained', containerId: 'item.bag-b' }, [bagA, bagB])).toEqual([
      'bag B cannot go inside itself',
    ]);
  });

  it('GEAR-053: a cycle already in the state does not hang the check', () => {
    const a = item(
      'item.a',
      'a',
      { type: 'contained', containerId: 'item.b' },
      {
        size: 'tiny',
        container: { capacity: 8, maxItemSize: 'small' },
      },
    );
    const b = item(
      'item.b',
      'b',
      { type: 'contained', containerId: 'item.a' },
      {
        size: 'tiny',
        container: { capacity: 8, maxItemSize: 'small' },
      },
    );
    const ring = item('item.ring', 'ring', nowhere, { size: 'tiny' });
    expect(move(ring, { type: 'contained', containerId: 'item.a' }, [a, b, ring])).toEqual([]);
  });

  it('GEAR-053: every starting item in the reference pack is legal where it starts', () => {
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
    expect(packItems.length).toBeGreaterThan(10);
    for (const packItem of packItems) {
      const issues = validateItemMove(
        packItem,
        packItem.location,
        packItems,
        { 'pc.wren': packWren },
        slots,
        ruleset,
      );
      expect(issues, packItem.id).toEqual([]);
    }
  });

  it('GEAR-053: placing and using up an item are always legal', () => {
    const cloak = items[0];
    expect(cloak && move(cloak, { type: 'placed', placeId: 'place.harbor' })).toEqual([]);
    expect(cloak && move(cloak, nowhere)).toEqual([]);
  });
});

describe('encumbrance mode', () => {
  const swords = item('item.swords', 'short swords', nowhere, { weight: 3, quantity: 15 });

  it('GEAR-050, GEAR-051: load counts worn and contained items; capacity is 10 + 5 × STR 2', () => {
    const rope = item('item.rope', 'rope', carried, { weight: 4 });
    const bag = item('item.bag', 'bag', held, {
      weight: 1,
      container: { capacity: 8, maxItemSize: 'small' },
    });
    const flask = item(
      'item.flask',
      'flask',
      { type: 'contained', containerId: 'item.bag' },
      { weight: 2, quantity: 2 },
    );
    const hat = item('item.hat', 'hat', worn('head', 0), { weight: 0.5 });
    expect(loadOf(wren, [rope, bag, flask, hat], encumbrance)).toEqual({ load: 9.5, capacity: 20 });
    expect(loadOf(wren, [rope], ruleset)).toBeNull();
  });

  it('GEAR-050: carried is allowed', () => {
    expect(move({ ...swords, quantity: 6 }, carried, [], encumbrance)).toEqual([]);
  });

  it('GEAR-052: fifteen swords (45) exceed twice capacity (40) and are refused', () => {
    expect(move(swords, carried, [], encumbrance)).toEqual([
      'too heavy: Wren cannot carry that much',
    ]);
  });

  it('GEAR-052: a full pack counts what is inside it', () => {
    const pack = item(
      'item.pack',
      'pack',
      { type: 'placed', placeId: 'place.harbor' },
      {
        weight: 2,
        container: { capacity: 50, maxItemSize: 'large' },
      },
    );
    const inside: Item = {
      ...swords,
      quantity: 13,
      location: { type: 'contained', containerId: 'item.pack' },
    };
    expect(move(pack, held, [pack, inside], encumbrance)).toEqual([
      'too heavy: Wren cannot carry that much',
    ]);
    expect(
      move(pack, { type: 'placed', placeId: 'place.dock' }, [pack, inside], encumbrance),
    ).toEqual([]);
  });

  it('GEAR-052: putting something in a container Wren holds counts toward her load', () => {
    const bag = item('item.bag', 'bag', held, {
      container: { capacity: 50, maxItemSize: 'large' },
    });
    expect(
      move(swords, { type: 'contained', containerId: 'item.bag' }, [bag], encumbrance),
    ).toEqual(['too heavy: Wren cannot carry that much']);
  });

  it('GEAR-052: without a hard limit, any load is allowed', () => {
    expect(move(swords, carried, [], encumbranceRules(null))).toEqual([]);
  });
});
