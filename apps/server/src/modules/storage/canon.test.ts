import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Place } from '@mythos/contracts';
import {
  HistoryFileSchema,
  SettingSchema,
  ThemeSchema,
  ToneProfileSchema,
} from '@mythos/contracts/content';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { type CanonEntry, listCanon, readCanon, readTemplates, writeCanon } from './canon';
import { createTestSpace, newTestCampaign } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
function fixture<T extends z.ZodType>(schema: T, ...parts: string[]): z.output<T> {
  return schema.parse(JSON.parse(readFileSync(path.join(repoRoot, ...parts), 'utf8')));
}

const harbor: Place = {
  id: 'place.harbor',
  kind: 'place',
  name: 'The Harbor',
  aliases: [],
  tags: ['coast'],
  parentPlaceId: 'place.brinemoor',
  description: 'Wet stone and gulls.',
};

function snapshotEntries(): CanonEntry[] {
  const pack = ['content-packs', 'reference'];
  const setting = fixture(SettingSchema, ...pack, 'setting.json');
  const tone = fixture(ToneProfileSchema, ...pack, 'tone-profiles', 'tone.coastal-mystery.json');
  const history = fixture(HistoryFileSchema, ...pack, 'history.json');
  const theme = fixture(ThemeSchema, 'content-library', 'themes', 'theme.house.json');
  return [
    { kind: 'setting', id: setting.id, value: setting, markdown: null },
    { kind: 'tone', id: tone.id, value: tone, markdown: null },
    { kind: 'history', id: 'reference', value: history, markdown: null },
    { kind: 'theme', id: theme.id, value: theme, markdown: null },
    { kind: 'entity', id: harbor.id, value: harbor, markdown: '# The Harbor\n\nCanon.\n' },
  ];
}

describe('canon', () => {
  it('ARCH-031: the content snapshot reads back exactly as written', async () => {
    const { db } = await newTestCampaign(space);
    const entries = snapshotEntries();
    const templates = [
      { layer: 'engine' as const, path: 'narrator.md', text: 'Narrate.' },
      { layer: 'engine' as const, path: 'partials/tone.md', text: '{{tone}}' },
      { layer: 'pack' as const, path: 'narrator.md', text: 'Narrate like the sea.' },
    ];
    writeCanon(db, { entries, templates });

    for (const entry of entries) expect(readCanon(db, entry.kind, entry.id)).toEqual(entry);
    expect(listCanon(db, 'entity')).toEqual([entries[4]]);
    expect(readCanon(db, 'entity', 'npc.nobody')).toBeNull();
    expect(readTemplates(db)).toEqual([templates[0], templates[1], templates[2]]);
  });

  it('ARCH-031: canon is written once; writing an entry again changes nothing', async () => {
    const { db } = await newTestCampaign(space);
    const entries = snapshotEntries();
    writeCanon(db, { entries: entries.slice(0, 2), templates: [] });
    expect(() => {
      writeCanon(db, { entries: entries.slice(1), templates: [] });
    }).toThrow(/UNIQUE/);
    expect(readCanon(db, 'history', 'reference')).toBeNull();
  });

  it('CONV-051: an entry whose JSON no longer matches its kind fails at read time', async () => {
    const { db } = await newTestCampaign(space);
    db.prepare(
      `INSERT INTO canon (kind, id, json, markdown) VALUES ('entity', 'place.void', '{"kind": "place"}', NULL)`,
    ).run();
    expect(() => readCanon(db, 'entity', 'place.void')).toThrow(
      /canon row id=place.void is invalid/,
    );
  });
});
