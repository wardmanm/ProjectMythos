import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CommitPayload, CommitPayloadSchema, type Faction } from '@mythos/contracts';
import {
  CalendarDefinitionSchema,
  RulesetSchema,
  SlotSchemaDefinitionSchema,
} from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { validateSet } from './fold';
import { type FoldContext, initialState } from './folded-state';
import { buildSetup, type SetupChoices, type SetupPack } from './setup';
import {
  character,
  commitSet,
  entryOf,
  historyEntry,
  item,
  place,
  ROOT_TURN,
  testId,
} from './test-support';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), 'utf8'));
const ruleset = RulesetSchema.parse(readJson('content-library/rulesets/ruleset.standard.json'));
const context: FoldContext = {
  ruleset,
  slots: SlotSchemaDefinitionSchema.parse(
    readJson('content-packs/reference/slot-schemas/slots.everyday.json'),
  ),
};
const calendar = CalendarDefinitionSchema.parse(
  readJson('content-library/calendars/calendar.gregorian.json'),
);

const guild: Faction = {
  id: 'faction.guild',
  kind: 'faction',
  name: 'guild',
  aliases: [],
  tags: [],
  description: '',
  goals: [],
};

/**
 * A town whose places and Wren's satchel sort after what they hold. Wren starts in town and
 * Tomas at the dock, and both must come to the inn, where Odette already is. Tomas wrote to
 * Wren; Odette keeps a secret.
 */
function townPack(): SetupPack {
  const entities = [
    place('place.dock', 'place.town'),
    place('place.inn', 'place.town'),
    place('place.town'),
    guild,
    character('npc.odette', { locationId: 'place.inn' }),
    character('npc.tomas', { locationId: 'place.dock' }),
    character('pc.wren', { locationId: 'place.town' }),
    item('item.apple', { type: 'contained', containerId: 'item.satchel' }, { size: 'tiny' }),
    item('item.locket', { type: 'placed', placeId: 'place.inn' }),
    item(
      'item.satchel',
      { type: 'held', characterId: 'pc.wren' },
      { ownerId: 'pc.wren', size: 'medium', container: { capacity: 8, maxItemSize: 'small' } },
    ),
  ];
  return {
    setting: { epoch: { year: 1874, month: 10, day: 12, hour: 0, minute: 0 }, epochWeekday: 1 },
    calendar,
    entities: entities.map((entity) => ({ entity })),
    startingStatuses: {
      'npc.tomas': [
        { name: 'Bruised Ribs', kind: 'harm', level: 1, tags: ['physical'] },
        { name: 'Grieving', kind: 'condition', tags: ['mental'], note: 'For the Merrow.' },
      ],
    },
    history: [
      historyEntry('letter', {
        when: { year: 1874, month: 10, day: 12, hour: 6, minute: 0 },
        kind: 'claim',
        actorIds: ['npc.tomas', 'faction.guild'],
        witnessIds: ['npc.tomas'],
        claim: {
          sourceId: 'npc.tomas',
          audienceIds: ['pc.wren'],
          content: 'Come quickly.',
          aboutRef: null,
          truthful: 'true',
        },
      }),
      historyEntry('secret', { witnessIds: ['npc.odette'] }),
    ],
    relationships: [
      {
        fromId: 'npc.odette',
        toId: 'pc.wren',
        dimensions: { trust: 9, loyalty: 2 },
        summary: 'A stranger.',
      },
      { fromId: 'npc.tomas', toId: 'pc.wren', dimensions: { fear: -2 }, summary: '' },
    ],
  };
}

const choices: SetupChoices = {
  scenario: {
    start: { year: 1874, month: 10, day: 12, hour: 18, minute: 0 },
    startPlaceId: 'place.inn',
    presentEntityIds: ['npc.odette', 'npc.tomas'],
  },
  pcId: 'pc.wren',
  ruleset,
  turnId: ROOT_TURN,
};

/** IDs from 101 upwards, so tests can name them. */
function seededIds(): () => string {
  let next = 100;
  return () => testId((next += 1));
}

const setupOf = (chosen = choices) => buildSetup(townPack(), chosen, seededIds());

function ofType<T extends CommitPayload['type']>(payloads: readonly CommitPayload[], type: T) {
  return payloads.filter(
    (payload): payload is Extract<CommitPayload, { type: T }> => payload.type === type,
  );
}

describe('buildSetup', () => {
  it('SCH-117: entities come as places, factions, characters, then items, by ID, with a later-sorting parent or container moved up', () => {
    const created = ofType(setupOf().payloads, 'entity.create').map(({ entity }) => entity.id);
    expect(created).toEqual([
      'place.town',
      'place.dock',
      'place.inn',
      'faction.guild',
      'npc.odette',
      'npc.tomas',
      'pc.wren',
      'item.satchel',
      'item.apple',
      'item.locket',
    ]);
  });

  it('SCH-117: the time advance, the moves of the PC and present characters, and the scene follow the entities', () => {
    const setup = setupOf();
    expect(setup.payloads.slice(10, 14)).toEqual<CommitPayload[]>([
      {
        type: 'time.advance',
        minutes: 18 * 60,
        reason: 'The scenario starts: Monday, October 12, 1874 (evening).',
      },
      { type: 'entity.move', characterId: 'pc.wren', toPlaceId: 'place.inn' },
      { type: 'entity.move', characterId: 'npc.tomas', toPlaceId: 'place.inn' },
      { type: 'scene.start', sceneId: testId(103), placeId: 'place.inn' },
    ]);
    expect(setup).toMatchObject({ sceneId: testId(103), startGameTime: 18 * 60 });
    for (const payload of setup.payloads) {
      expect(CommitPayloadSchema.parse(payload)).toEqual(payload);
    }
  });

  it('SCH-117: a scenario that starts at the epoch has no time advance', () => {
    const start = townPack().setting.epoch;
    const setup = setupOf({ ...choices, scenario: { ...choices.scenario, start } });
    expect(setup.startGameTime).toBe(0);
    expect(ofType(setup.payloads, 'time.advance')).toEqual([]);
  });

  it('SCH-005: starting statuses get new IDs and the scenario start as their times, neither permanent nor treated', () => {
    const creates = ofType(setupOf().payloads, 'entity.create');
    const tomas = creates.find(({ entity }) => entity.id === 'npc.tomas')?.entity;
    const at = { permanent: false, treated: false, inflictedAt: 18 * 60, changedAt: 18 * 60 };
    expect(tomas).toMatchObject({
      statuses: [
        {
          id: testId(101),
          name: 'Bruised Ribs',
          kind: 'harm',
          level: 1,
          tags: ['physical'],
          ...at,
        },
        {
          id: testId(102),
          name: 'Grieving',
          kind: 'condition',
          tags: ['mental'],
          note: 'For the Merrow.',
          ...at,
        },
      ],
    });
    expect(creates.find(({ entity }) => entity.id === 'pc.wren')?.entity).toMatchObject({
      statuses: [],
    });
  });

  it("SCH-117: history follows the scene, then relationships, then the PC's names", () => {
    const types = setupOf()
      .payloads.slice(14)
      .map(({ type }) => type);
    expect(types).toEqual([
      'observation.add',
      'knowledge.grant',
      'knowledge.grant',
      'observation.add',
      'knowledge.grant',
      'relationship.set',
      'relationship.set',
      'knowledge.name',
    ]);
  });

  it('SCH-092: seed relationships drop dimensions the ruleset lacks and clamp values to its range, with warnings', () => {
    const setup = buildSetup(townPack(), choices, seededIds());
    expect(ofType(setup.payloads, 'relationship.set')).toEqual([
      {
        type: 'relationship.set',
        fromId: 'npc.odette',
        toId: 'pc.wren',
        dimensions: { trust: 5 },
        summary: 'A stranger.',
      },
      {
        type: 'relationship.set',
        fromId: 'npc.tomas',
        toId: 'pc.wren',
        dimensions: { fear: -2 },
        summary: '',
      },
    ]);
    const narrowRange = {
      ...choices,
      ruleset: { ...ruleset, relationships: { ...ruleset.relationships, min: -1, max: 1 } },
    };
    expect(buildSetup(townPack(), narrowRange, seededIds()).warnings).toEqual([
      "the relationship from npc.odette to pc.wren has trust 9, outside ruleset.standard's -1 to 1, so it is 1",
      'the relationship from npc.odette to pc.wren drops "loyalty": it is not a dimension in ruleset.standard',
      "the relationship from npc.tomas to pc.wren has fear -2, outside ruleset.standard's -1 to 1, so it is -1",
    ]);
  });

  it("JRN-022: the PC learns the names of the other characters in the entries it knows, in ID order, and no faction's", () => {
    expect(ofType(setupOf().payloads, 'knowledge.name')).toEqual([
      { type: 'knowledge.name', knowerId: 'pc.wren', entityId: 'npc.tomas', name: 'tomas' },
    ]);
  });

  it('TRN-056, SCH-118: the setup set passes validateSet and folds to everyone present at the start place', () => {
    const setup = setupOf();
    const entry = entryOf(commitSet(0, 'setup'), setup.payloads);
    const start = initialState({
      pcId: 'pc.wren',
      scenePlaceId: 'place.inn',
      sceneId: setup.sceneId,
    });
    const result = validateSet(start, entry, context);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const { world, relationships } = result.value;
    expect(world).toMatchObject({
      gameTime: 18 * 60,
      sceneId: setup.sceneId,
      scenePlaceId: 'place.inn',
    });
    for (const id of ['pc.wren', 'npc.odette', 'npc.tomas']) {
      expect(world.entities[id]).toMatchObject({ locationId: 'place.inn' });
    }
    expect(Object.keys(relationships)).toEqual(['npc.odette>pc.wren', 'npc.tomas>pc.wren']);
  });
});
