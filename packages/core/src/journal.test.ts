import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Character, Faction, Item, Place } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { commonKnowledge, displayName } from './journal';

const packDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../content-packs/reference',
);

const character = (id: string, name: string, aliases: string[]): Character => ({
  id,
  kind: 'npc',
  name,
  aliases,
  tags: [],
  ageCategory: 'adult',
  stats: {},
  statuses: [],
  physicalDescription: '',
  personality: '',
  goals: [],
  keyNpc: false,
  locationId: null,
  lifeState: 'alive',
});
const varek = character('npc.varek', 'Varek Holm', ['the clerk']);
const stranger = character('npc.stranger', 'Ines Crale', []);

describe('displayName', () => {
  it('JRN-020: before introductions, a character is their first alias, never their true name', () => {
    expect(displayName(varek, 'pc.wren', [])).toBe('the clerk');
  });

  it('JRN-020: with no alias either, a character is someone you have not been introduced to', () => {
    expect(displayName(stranger, 'pc.wren', [])).toBe('someone you have not been introduced to');
  });

  it('JRN-020: the latest learned name wins, and only names learned for that entity count', () => {
    const learned = [
      { entityId: 'npc.varek', name: 'the lean clerk' },
      { entityId: 'npc.odette', name: 'Odette' },
    ];
    expect(displayName(varek, 'pc.wren', learned)).toBe('the lean clerk');
    learned.push({ entityId: 'npc.varek', name: 'Varek' });
    expect(displayName(varek, 'pc.wren', learned)).toBe('Varek');
  });

  it('JRN-020: a character always knows their own name', () => {
    expect(displayName(varek, 'npc.varek', [])).toBe('Varek Holm');
  });

  it('JRN-020: places, factions, and items go by their name', () => {
    const place: Place = {
      id: 'place.harbor',
      kind: 'place',
      name: 'Brinemoor Harbor',
      aliases: [],
      tags: [],
      parentPlaceId: null,
      description: '',
    };
    const faction: Faction = {
      id: 'faction.tide-wardens',
      kind: 'faction',
      name: 'Tide Wardens',
      aliases: ['the wardens'],
      tags: [],
      description: '',
      goals: [],
    };
    const item: Item = {
      id: 'item.harbor-ledger',
      kind: 'item',
      name: 'green ledger',
      aliases: [],
      tags: [],
      description: '',
      location: { type: 'placed', placeId: 'place.harbor-office' },
      ownerId: null,
      quantity: 1,
      bonuses: [],
    };
    expect([place, faction, item].map((entity) => displayName(entity, 'pc.wren', []))).toEqual([
      'Brinemoor Harbor',
      'Tide Wardens',
      'green ledger',
    ]);
  });
});

describe('commonKnowledge', () => {
  it('JRN-031: only the common knowledge section, never the rest of the canon', () => {
    const canon =
      'Varek has clerked here for twelve years.\n\n## Common knowledge\n\n' +
      'The harbor clerk. Polite, dry, never late.\n\n## Secrets\n\nKeeps a second ledger.';
    expect(commonKnowledge(canon)).toBe('The harbor clerk. Polite, dry, never late.');
  });

  it('JRN-031: deeper headings stay in the section, and it may end the file', () => {
    const canon = 'Intro.\n\n## Common Knowledge\n\nKnown.\n\n### Rumors\n\nSaid to drink.\n';
    expect(commonKnowledge(canon)).toBe('Known.\n\n### Rumors\n\nSaid to drink.');
  });

  it('JRN-031: Windows line endings read the same', () => {
    const canon =
      'Intro.\r\n\r\n## Common knowledge\r\n\r\nKnown.\r\nAlso known.\r\n\r\n## Secrets\r\nHidden.';
    expect(commonKnowledge(canon)).toBe('Known.\nAlso known.');
  });

  it('JRN-031: no section, or an empty one, is no common knowledge', () => {
    expect(commonKnowledge('Just canon.')).toBeNull();
    expect(commonKnowledge('## Common knowledge\n\n## Secrets\n\nHidden.')).toBeNull();
  });

  it("JRN-031: Varek's canon in the reference pack", () => {
    const canon = readFileSync(path.join(packDir, 'entities/characters/npc.varek.md'), 'utf8');
    expect(commonKnowledge(canon)).toBe(
      'The harbor clerk. Courteous and dryly funny, and the one who signs every boat in and\n' +
        'out of Brinemoor.',
    );
  });
});
