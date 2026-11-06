import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ContentSettings } from '@mythos/contracts/content';
import { afterEach, describe, expect, it } from 'vitest';
import { type CanonKind, listCanon, readCanon, readStateHistory, readTemplates } from '../storage';
import { createCampaign } from './create-campaign';
import { arrivalCommand, createTestSpace } from './testing';

const space = createTestSpace();
afterEach(() => {
  space.cleanUp();
});

async function created(deps: ReturnType<typeof space.deps>, command = arrivalCommand()) {
  const result = await createCampaign(deps, command);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  const opened = deps.store.openCampaign(result.value.campaignId);
  if (!opened.ok) throw new Error('the new campaign would not open');
  return opened.value;
}

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

const KINDS: readonly CanonKind[] = [
  'setting',
  'calendar',
  'slots',
  'tone',
  'ruleset',
  'scenario',
  'theme',
  'entity',
  'history',
  'relationships',
];

describe('the content snapshot', () => {
  it('SCH-111: canon holds the chosen definitions, the scenario and its opening, every entity with its canon, history, and relationships', async () => {
    const db = await created(space.deps());
    for (const kind of KINDS) expect(listCanon(db, kind).length, kind).toBeGreaterThan(0);
    expect(listCanon(db, 'tone').map(({ id }) => id)).toEqual(['tone.coastal-mystery']);
    expect(listCanon(db, 'theme').map(({ id }) => id)).toEqual(['theme.brine']);
    expect(listCanon(db, 'slots').map(({ id }) => id)).toEqual(['slots.everyday']);
    expect(listCanon(db, 'entity')).toHaveLength(27);
    expect(readCanon(db, 'scenario', 'scenario.arrival')?.markdown).toMatch(/^# Arrival\n/);
    expect(readCanon(db, 'entity', 'npc.varek')?.markdown).toMatch(/## Common knowledge/);
    expect(readCanon(db, 'entity', 'item.boots')?.markdown).toBeNull();
    expect(readCanon(db, 'history', 'reference')?.value.entries).toHaveLength(11);
    expect(readCanon(db, 'relationships', 'reference')?.value.relationships).toHaveLength(10);
  });

  it('CTX-005: tone profile, pack, ruleset, and engine templates are snapshotted by layer and path, as LF text without a BOM', async () => {
    const dataDir = space.folder();
    const packDir = space.copyReferencePack(dataDir);
    const sources = space.onlyDataDir(dataDir);
    // A copy of the built-in library, so the ruleset and the engine can have templates too.
    const library = path.join(dataDir, 'built-in');
    cpSync(sources.builtInLibrary, library, { recursive: true });
    const engine = path.join(library, 'templates');
    write(path.join(packDir, 'templates', 'narrator.md'), '﻿Pack narrator.\r\nSecond line.\r\n');
    write(path.join(packDir, 'templates', 'partials', 'tone.md'), 'Pack tone.');
    write(path.join(packDir, 'templates', '.DS_Store'), 'not a template');
    write(
      path.join(packDir, 'tone-profiles', 'tone.coastal-mystery', 'templates', 'narrator.md'),
      'Tone narrator.',
    );
    write(
      path.join(
        library,
        'rulesets',
        'ruleset.standard',
        'templates',
        'partials',
        'stakes-rules.md',
      ),
      'Stakes.',
    );
    write(path.join(engine, 'partials', 'tone.md'), 'Engine tone.');
    write(path.join(engine, 'partials-extra.md'), 'Sorts before partials/.');
    write(path.join(engine, 'narrator.md'), 'Engine narrator.');
    const deps = space.deps({
      dataDir,
      sources: { ...sources, builtInLibrary: library, engineTemplates: engine },
    });

    const db = await created(deps);
    expect(readTemplates(db)).toEqual([
      { layer: 'engine', path: 'narrator.md', text: 'Engine narrator.' },
      { layer: 'engine', path: 'partials-extra.md', text: 'Sorts before partials/.' },
      { layer: 'engine', path: 'partials/tone.md', text: 'Engine tone.' },
      { layer: 'pack', path: 'narrator.md', text: 'Pack narrator.\nSecond line.\n' },
      { layer: 'pack', path: 'partials/tone.md', text: 'Pack tone.' },
      { layer: 'ruleset', path: 'partials/stakes-rules.md', text: 'Stakes.' },
      { layer: 'tone-profile', path: 'narrator.md', text: 'Tone narrator.' },
    ]);
  });

  it('CTX-005: a layer with no templates folder snapshots no files', async () => {
    const db = await created(space.deps());
    expect(readTemplates(db)).toEqual([]);
  });

  it("CSET-020: the first content settings version is the tone profile's", async () => {
    const db = await created(space.deps());
    const tone = readCanon(db, 'tone', 'tone.coastal-mystery')?.value;
    expect(
      readStateHistory(db, 'content_settings').map(({ version, value }) => [version, value]),
    ).toEqual([[1, tone?.content]]);
  });

  it("CSET-020: a command's own content settings replace the tone profile's", async () => {
    const own: ContentSettings = {
      violence: 'off',
      gore: 'off',
      sexual: 'off',
      language: 'fade-to-black',
      disturbing: 'moderate',
      lines: ['drowning'],
      veils: [],
    };
    const db = await created(space.deps(), arrivalCommand({ contentSettings: own }));
    expect(readStateHistory(db, 'content_settings').map(({ value }) => value)).toEqual([own]);
  });
});
