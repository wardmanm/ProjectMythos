import { beforeAll, describe, expect, it } from 'vitest';
import { referenceSources, validate, withReplaced } from './test-pack';
import type { SourceFiles } from './types';

let pack: SourceFiles;
let builtIn: SourceFiles;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
});

const item = (id: string) => `entities/items/${id}.json`;

describe('item checks', () => {
  it('SCH-082: every starting item in the reference pack is legal where it starts', () => {
    expect(validate(pack, builtIn).issues).toEqual([]);
  });

  it('SCH-082: an overfull pocket is an issue at startingLocation', () => {
    const broken = withReplaced(
      pack,
      item('item.coins'),
      '"size": "tiny"',
      '"size": "tiny", "quantity": 3',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: item('item.coins'),
        path: 'startingLocation',
        message: 'wool trousers has room for 2 more; coins needs 3',
      },
    ]);
  });

  it('SCH-082: an unknown slot is an issue at startingLocation', () => {
    const broken = withReplaced(pack, item('item.boots'), '"slot": "feet"', '"slot": "belt"');
    expect(validate(broken, builtIn).issues).toEqual([
      { file: item('item.boots'), path: 'startingLocation', message: 'there is no "belt" slot' },
    ]);
  });

  it('SCH-082: a container cycle is an issue for each item in it', () => {
    const broken = withReplaced(
      pack,
      item('item.carpetbag'),
      '{"type": "held", "characterId": "pc.wren"}',
      '{"type": "contained", "containerId": "item.spare-clothes"}',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: item('item.carpetbag'),
        path: 'startingLocation.containerId',
        message: 'containers form a cycle: item.carpetbag → item.spare-clothes → item.carpetbag',
      },
      {
        file: item('item.spare-clothes'),
        path: 'startingLocation.containerId',
        message:
          'containers form a cycle: item.spare-clothes → item.carpetbag → item.spare-clothes',
      },
    ]);
  });

  it('SCH-082: an item in a missing container is reported once, as a reference', () => {
    const broken = withReplaced(pack, item('item.coins'), '"item.wool-trousers"', '"item.purse"');
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: item('item.coins'),
        path: 'startingLocation.containerId',
        message: '"item.purse" is not an entity in this pack',
      },
    ]);
  });

  it('SCH-082: a wearable slot the slot schema lacks is an issue', () => {
    const broken = withReplaced(
      pack,
      item('item.silver-locket'),
      '"slots": ["neck"]',
      '"slots": ["neck", "wrist"]',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: item('item.silver-locket'),
        path: 'wearable.slots.1',
        message: '"wrist" is not a slot in slots.everyday',
      },
    ]);
  });

  it("CON-024: a bonus's stat and tags are the default ruleset's", () => {
    const knife = withReplaced(
      pack,
      item('item.fishing-knife'),
      '"points": 1}',
      '"points": 1, "stat": "wis"}',
    );
    const boots = withReplaced(
      knife,
      item('item.boots'),
      '"wearable": {"slots": ["feet"]}',
      '"wearable": {"slots": ["feet"]}, "bonuses": [{"type": "harm-reduction", "levels": 1, "tags": ["cold"]}]',
    );
    expect(validate(boots, builtIn).issues).toEqual([
      {
        file: item('item.boots'),
        path: 'bonuses.0.tags.0',
        message: '"cold" is not a harm tag in ruleset.standard',
      },
      {
        file: item('item.fishing-knife'),
        path: 'bonuses.0.stat',
        message: '"wis" is not a stat in ruleset.standard',
      },
    ]);
  });

  it('GEAR-065: an item name that starts with an article is an issue', () => {
    const broken = withReplaced(
      pack,
      item('item.carpetbag'),
      '"name": "carpetbag"',
      '"name": "a carpetbag"',
    );
    expect(validate(broken, builtIn).issues).toEqual([
      {
        file: item('item.carpetbag'),
        path: 'name',
        message: '"a carpetbag" starts with an article; write it as it reads in a list',
      },
    ]);
  });
});
