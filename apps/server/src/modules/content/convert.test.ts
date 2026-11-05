import path from 'node:path';
import { EntitySchema } from '@mythos/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { toLoadedPack } from './convert';
import { referenceSources, validate, withReplaced, withTemplateDirs } from './test-pack';
import type { LoadedPack, SourceFiles } from './types';

let pack: SourceFiles;
let builtIn: SourceFiles;
beforeAll(async () => {
  ({ pack, builtIn } = await referenceSources());
});

const ENGINE = path.join(path.sep, 'mythos', 'content-library', 'templates');

function load(source: SourceFiles): LoadedPack {
  const { content, issues } = validate(source, builtIn);
  expect(issues).toEqual([]);
  return toLoadedPack(content, ENGINE);
}

function entity(loaded: LoadedPack, id: string) {
  return loaded.entities.find((each) => each.entity.id === id)?.entity;
}

describe('toLoadedPack', () => {
  it('SCH-005: Varek converts with voiceProfile, locationId, goals, and no statuses yet', () => {
    const varek = entity(load(pack), 'npc.varek');
    expect(varek).toMatchObject({
      kind: 'npc',
      locationId: 'place.harbor-office',
      lifeState: 'alive',
      statuses: [],
      goals: [
        "Keep the truth about the Merrow's Luck buried",
        'Pay off his debt to the smugglers before winter',
      ],
      voiceProfile: {
        description:
          "Low, dry, and unhurried; a clerk's careful diction that tightens when pressed.",
      },
    });
    expect(varek).not.toHaveProperty('voice');
    expect(varek).not.toHaveProperty('startingLocationId');
  });

  it('SCH-005: items convert with location, and every entity is in runtime form', () => {
    const loaded = load(pack);
    expect(entity(loaded, 'item.fishing-knife')).toMatchObject({
      location: { type: 'worn', characterId: 'pc.wren', slot: 'legs', layer: 1 },
      ownerId: 'pc.wren',
      quantity: 1,
      wearable: { slots: ['legs'], covers: [] },
    });
    expect(entity(loaded, 'item.fishing-knife')).not.toHaveProperty('startingLocation');
    for (const { entity: each } of loaded.entities) expect(EntitySchema.parse(each)).toEqual(each);
    const ids = loaded.entities.map((each) => each.entity.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('SCH-005: startingStatuses stay authored, by character', () => {
    const status = {
      name: 'Bad Knee',
      kind: 'harm',
      level: 1,
      tags: ['physical'],
      note: 'An old fall.',
    };
    const json = `"startingStatuses": [${JSON.stringify(status)}], "startingLocationId"`;
    const loaded = load(
      withReplaced(pack, 'entities/characters/npc.varek.json', '"startingLocationId"', json),
    );
    expect(loaded.startingStatuses['npc.varek']).toEqual([status]);
    expect(loaded.startingStatuses['pc.wren']).toEqual([]);
    expect(entity(loaded, 'npc.varek')).toMatchObject({ statuses: [] });
  });

  it('SCH-081: goals carry over, and a character without goals has none', () => {
    const loaded = load(pack);
    expect(entity(loaded, 'faction.tide-wardens')).toMatchObject({
      goals: [
        'Stop the night smuggling before the winter storms',
        'Keep the harbor safe with too few wardens',
      ],
    });
    expect(entity(loaded, 'pc.wren')).toMatchObject({ goals: [] });
  });

  it('SCH-083: keyNpc carries over and defaults to false', () => {
    const flagged = withReplaced(
      pack,
      'entities/characters/npc.varek.json',
      '"startingLocationId"',
      '"keyNpc": true, "startingLocationId"',
    );
    const loaded = load(flagged);
    expect(entity(loaded, 'npc.varek')).toMatchObject({ keyNpc: true });
    expect(entity(loaded, 'npc.odette')).toMatchObject({ keyNpc: false });
  });

  it('SCH-003: canon and openings come from their Markdown files', () => {
    const loaded = load(pack);
    expect(loaded.entities.find((each) => each.entity.id === 'npc.varek')?.canon).toBe(
      pack.files.get('entities/characters/npc.varek.md'),
    );
    expect(loaded.scenarios.map(({ scenario }) => scenario.id)).toEqual(['scenario.arrival']);
    expect(loaded.scenarios[0]?.opening).toBe(pack.files.get('scenarios/arrival.md'));
  });

  it('SCH-023: templates folders are absolute paths beside their definitions, or null', () => {
    const withTemplates = withTemplateDirs(pack, [
      'templates',
      'tone-profiles/tone.coastal-mystery/templates',
    ]);
    const loaded = load(withTemplates);
    expect(loaded.templates).toEqual({ pack: path.join(pack.root, 'templates'), engine: ENGINE });
    const tones = Object.fromEntries(loaded.toneProfiles.map((tone) => [tone.definition.id, tone]));
    expect(tones['tone.coastal-mystery']).toMatchObject({
      source: 'pack',
      templatesDir: path.join(pack.root, 'tone-profiles', 'tone.coastal-mystery', 'templates'),
    });
    expect(tones['tone.grimdark']).toMatchObject({ source: 'built-in', templatesDir: null });
    expect(load(pack).templates.pack).toBeNull();
  });

  it('SCH-010: the loaded pack resolves its calendar, slot schemas, and every option', () => {
    const loaded = load(pack);
    expect(loaded.calendar.id).toBe('calendar.gregorian');
    expect(Object.keys(loaded.slotSchemas)).toEqual(['slots.everyday']);
    expect(loaded.toneProfiles.map((tone) => tone.definition.id)).toEqual([
      'tone.coastal-mystery',
      'tone.adventure',
      'tone.grimdark',
      'tone.romance',
      'tone.science-fiction',
    ]);
    expect(loaded.rulesets.map((ruleset) => ruleset.source)).toEqual([
      'built-in',
      'built-in',
      'built-in',
      'built-in',
    ]);
    expect(loaded.themes).toHaveLength(6);
    expect(loaded.history).toHaveLength(11);
    expect(loaded.relationships).toHaveLength(10);
  });
});
