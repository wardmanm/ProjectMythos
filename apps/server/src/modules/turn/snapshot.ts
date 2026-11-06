// The content snapshot a new campaign keeps (SCH-111, ARCH-045): canon entries from the
// pack as loaded, and the template files of four layers (CTX-005). From then on the
// campaign reads only these.
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cmp } from '@mythos/core';
import type { LoadedPack } from '../content';
import type { CanonEntry, CanonTemplate, SnapshotTemplateLayer } from '../storage';
import type { CheckedCommand } from './check-command';

/**
 * The chosen definitions, the scenario with its opening, every entity in runtime form with
 * its canon Markdown, and history and relationships, all as the pack loaded them. Setup's
 * removals and starting statuses are in the setup set, not here (04-content-schemas
 * Decisions). Implements SCH-111.
 */
export function canonEntries(pack: LoadedPack, checked: CheckedCommand): CanonEntry[] {
  const { setting, calendar } = pack;
  const packId = pack.manifest.id;
  return [
    { kind: 'setting', id: setting.id, value: setting, markdown: null },
    { kind: 'calendar', id: calendar.id, value: calendar, markdown: null },
    { kind: 'slots', id: checked.slots.id, value: checked.slots, markdown: null },
    {
      kind: 'tone',
      id: checked.toneProfile.definition.id,
      value: checked.toneProfile.definition,
      markdown: null,
    },
    {
      kind: 'ruleset',
      id: checked.ruleset.definition.id,
      value: checked.ruleset.definition,
      markdown: null,
    },
    {
      kind: 'scenario',
      id: checked.scenario.id,
      value: checked.scenario,
      markdown: checked.opening,
    },
    { kind: 'theme', id: checked.theme.id, value: checked.theme, markdown: null },
    ...pack.entities.map(({ entity, canon }): CanonEntry => ({
      kind: 'entity',
      id: entity.id,
      value: entity,
      markdown: canon === '' ? null : canon,
    })),
    {
      kind: 'history',
      id: packId,
      value: { schemaVersion: 1, entries: [...pack.history] },
      markdown: null,
    },
    {
      kind: 'relationships',
      id: packId,
      value: { schemaVersion: 1, relationships: [...pack.relationships] },
      markdown: null,
    },
  ];
}

/** Text as every OS should see it: LF line endings and no BOM (CONV-083). */
function normalizeText(text: string): string {
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

async function listSorted(dir: string): Promise<Dirent[] | null> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    // Directory listings come back in a different order on each OS (CONV-087).
    return entries.sort((a, b) => cmp(a.name, b.name));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Every Markdown file under `root`, by forward-slash path; none when `root` is missing. */
async function markdownFiles(
  root: string,
  parts: readonly string[] = [],
): Promise<{ path: string; text: string }[]> {
  const entries = await listSorted(path.join(root, ...parts));
  if (entries === null) return [];
  const found: { path: string; text: string }[] = [];
  for (const entry of entries) {
    // Dot-files and dot-folders (.git, .DS_Store) are never templates.
    if (entry.name.startsWith('.')) continue;
    const childParts = [...parts, entry.name];
    if (entry.isDirectory()) {
      found.push(...(await markdownFiles(root, childParts)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const text = await readFile(path.join(root, ...childParts), 'utf8');
      found.push({ path: childParts.join('/'), text: normalizeText(text) });
    }
  }
  return found;
}

/**
 * The template files of the tone profile, the pack, the ruleset, and the engine, each
 * layer's sorted by path with `cmp`. A layer whose folder is missing has none.
 * Implements CTX-005.
 */
export async function templateFiles(
  pack: LoadedPack,
  checked: CheckedCommand,
): Promise<CanonTemplate[]> {
  const layers: [SnapshotTemplateLayer, string | null][] = [
    ['tone-profile', checked.toneProfile.templatesDir],
    ['pack', pack.templates.pack],
    ['ruleset', checked.ruleset.templatesDir],
    ['engine', pack.templates.engine],
  ];
  const templates: CanonTemplate[] = [];
  for (const [layer, dir] of layers) {
    if (dir === null) continue;
    // Sorting by whole path, not folder by folder: "a-b.md" sorts before "a/z.md".
    const files = (await markdownFiles(dir)).sort((a, b) => cmp(a.path, b.path));
    templates.push(...files.map(({ path: at, text }) => ({ layer, path: at, text })));
  }
  return templates;
}
