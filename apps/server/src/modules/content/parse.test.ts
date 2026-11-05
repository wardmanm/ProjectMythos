import { AuthoredEntitySchema, PackManifestSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { nestedUnknownKeys, parseFile } from './parse';

const manifest = {
  schemaVersion: 1,
  id: 'reference',
  name: 'Brinemoor',
  version: '0.1.0',
  description: 'A fog-bound town.',
};

const item = {
  schemaVersion: 1,
  id: 'item.lantern',
  kind: 'item',
  name: 'lantern',
  description: 'A storm lantern.',
  startingLocation: { type: 'held', characterId: 'pc.wren' },
  size: 'small',
};

function parseManifest(json: unknown) {
  return parseFile('pack.json', JSON.stringify(json), PackManifestSchema);
}

function parseEntity(json: unknown) {
  const file = 'entities/items/item.lantern.json';
  return parseFile(file, JSON.stringify(json), AuthoredEntitySchema, nestedUnknownKeys);
}

describe('parseFile', () => {
  it('SCH-001: an unknown key at the top level is an issue at its own path', () => {
    const result = parseManifest({ ...manifest, lethalty: 'lethal', autor: 'Mythos' });
    expect(result.value).toBeNull();
    expect(result.issues).toEqual([
      { file: 'pack.json', path: 'lethalty', message: 'unknown key "lethalty"' },
      { file: 'pack.json', path: 'autor', message: 'unknown key "autor"' },
    ]);
  });

  it('SCH-001: an unknown key inside a strict nested object is an issue at its path', () => {
    const wearable = { slots: ['hands'], cover: ['torso'] };
    const result = parseEntity({ ...item, wearable });
    expect(result.issues).toEqual([
      {
        file: 'entities/items/item.lantern.json',
        path: 'wearable.cover',
        message: 'unknown key "cover"',
      },
    ]);
  });

  it('SCH-001: an unknown key inside a non-strict runtime object is still an issue at its path', () => {
    const result = parseEntity({
      ...item,
      media: { imagePromt: 'brass lantern' },
      startingLocation: { type: 'held', characterId: 'pc.wren', hand: 'left' },
      container: { capacity: 1, maxItemSize: 'tiny', lid: true },
      bonuses: [
        { type: 'roll', situation: 'seeing in the dark', points: 1 },
        { type: 'resistance', tags: ['physical'], points: 1, against: 'cold' },
      ],
    });
    expect(result.issues.map((issue) => issue.path)).toEqual([
      'media.imagePromt',
      'startingLocation.hand',
      'container.lid',
      'bonuses.1.against',
    ]);
    // Zod drops the keys and the rest parses, so later passes still check the entity.
    expect(result.value?.id).toBe('item.lantern');
  });

  it('SCH-001: a voice profile with an unknown key is reported at its path', () => {
    const character = {
      schemaVersion: 1,
      id: 'npc.varek',
      kind: 'npc',
      name: 'Varek Holm',
      ageCategory: 'adult',
      stats: { str: 3 },
      physicalDescription: '',
      personality: 'Careful.',
      voice: { description: 'Low and dry.', pitch: 'low' },
      startingLocationId: null,
    };
    const result = parseFile(
      'npc.varek.json',
      JSON.stringify(character),
      AuthoredEntitySchema,
      nestedUnknownKeys,
    );
    expect(result.issues).toEqual([
      { file: 'npc.varek.json', path: 'voice.pitch', message: 'unknown key "pitch"' },
    ]);
  });

  it('SCH-001: a file that is not JSON is one issue for the whole file', () => {
    const result = parseFile('pack.json', '{ "schemaVersion": 1,', PackManifestSchema);
    expect(result.value).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.path).toBe('');
    expect(result.issues[0]?.message).toMatch(/^not valid JSON: /);
  });

  it('SCH-002: a missing schemaVersion is an issue that says what to write', () => {
    const result = parseManifest({ ...manifest, schemaVersion: undefined });
    expect(result.value).toBeNull();
    expect(result.issues).toEqual([
      {
        file: 'pack.json',
        path: 'schemaVersion',
        message: 'missing: every content file declares "schemaVersion": 1',
      },
    ]);
  });

  it('SCH-002: a newer schemaVersion asks for a newer Mythos, and nothing else is reported', () => {
    const result = parseManifest({ ...manifest, schemaVersion: 2, newField: true });
    expect(result.issues).toEqual([
      {
        file: 'pack.json',
        path: 'schemaVersion',
        message:
          '2 is newer than this version of Mythos can read (1); update Mythos to use this file',
      },
    ]);
  });

  it('SCH-002: any other schemaVersion must be 1', () => {
    const result = parseManifest({ ...manifest, schemaVersion: '1' });
    expect(result.issues).toEqual([
      { file: 'pack.json', path: 'schemaVersion', message: 'must be 1' },
    ]);
  });
});
