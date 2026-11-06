// Helpers for this module's tests only: the standard ruleset, layers held in memory, and
// temporary folders in os.tmpdir() (CONV-116). Not exported from index.ts.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Ruleset, RulesetSchema } from '@mythos/contracts/content';
import { buildSetup, type CommitSetEntry, fold, initialState } from '@mythos/core';
import { createContent, defaultSources } from '../content';
import type { CanonTemplate, SnapshotTemplateLayer } from '../storage';
import type { CampaignAtPoint } from './read';
import { layeredLookup, type TemplateLookup } from './templates';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The built-in library's standard ruleset. */
export function standardRuleset(): Ruleset {
  const file = path.join(repositoryRoot, 'content-library', 'rulesets', 'ruleset.standard.json');
  return RulesetSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** The engine's templates in `content-library/templates/`, by forward-slash path. */
export function engineTemplates(): Record<string, string> {
  const root = path.join(repositoryRoot, 'content-library', 'templates');
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(root, full).split(path.sep).join('/')] = readFileSync(full, 'utf8');
  }
  return files;
}

/**
 * The reference pack's *Arrival* at turn zero, in memory: the pack loaded through the
 * content module, its setup set built by core and folded, with no database.
 */
export async function referenceAtTurnZero(): Promise<CampaignAtPoint> {
  const content = createContent({
    sources: defaultSources(tmpdir()),
    logger: { warn: () => undefined },
  });
  const loaded = await content.loadPack('reference');
  if (!loaded.ok) throw new Error(loaded.error.message);
  const pack = loaded.value;
  const tone = pack.toneProfiles.find(({ definition }) => definition.id === 'tone.coastal-mystery');
  const ruleset = pack.rulesets.find(({ definition }) => definition.id === 'ruleset.standard');
  const [arrival] = pack.scenarios;
  const slots = pack.slotSchemas[pack.setting.slotSchemaId];
  if (tone === undefined || ruleset === undefined || arrival === undefined || slots === undefined) {
    throw new Error('the reference pack has changed');
  }
  let next = 0;
  const newId = () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, '0')}`;
  const choices = {
    scenario: arrival.scenario,
    pcId: 'pc.wren',
    ruleset: ruleset.definition,
    turnId: newId(),
  };
  const setup = buildSetup(pack, choices, newId);
  const start = initialState({
    pcId: 'pc.wren',
    scenePlaceId: arrival.scenario.startPlaceId,
    sceneId: setup.sceneId,
  });
  const setId = newId();
  const entry: CommitSetEntry = {
    set: {
      id: setId,
      turnId: choices.turnId,
      stage: 'setup',
      origin: 'engine',
      supersedesSetId: null,
      basedOnSetIds: [],
      copiedFromSetId: null,
      schemaVersion: 1,
      seq: 0,
      createdAt: '2026-11-05T12:00:00.000Z',
    },
    commits: setup.payloads.map((payload, seq) => ({ id: newId(), setId, seq, payload })),
  };
  const { state } = fold(start, [entry], { ruleset: ruleset.definition, slots });
  return {
    pcId: 'pc.wren',
    setting: pack.setting,
    calendar: pack.calendar,
    slots,
    tone: tone.definition,
    ruleset: ruleset.definition,
    scenario: arrival.scenario,
    opening: arrival.opening,
    contentSettings: tone.definition.content,
    state,
    sceneTurns: [],
    turn: { opening: true },
  };
}

/** Files by layer and path, for `memoryLookup`. */
export type MemoryLayers = {
  campaign?: Record<string, string>;
  profileDir?: string;
} & Partial<Record<SnapshotTemplateLayer, Record<string, string>>>;

/** A lookup over files held in memory, through `layeredLookup`'s priority. */
export function memoryLookup(layers: MemoryLayers): TemplateLookup {
  const snapshot: CanonTemplate[] = [];
  for (const layer of ['engine', 'pack', 'ruleset', 'tone-profile'] as const) {
    for (const [filePath, text] of Object.entries(layers[layer] ?? {})) {
      snapshot.push({ layer, path: filePath, text });
    }
  }
  return layeredLookup({
    campaign: (filePath) => layers.campaign?.[filePath] ?? null,
    profileDir: layers.profileDir ?? null,
    snapshot,
  });
}

/** Temporary folders that `cleanUp` (run in `afterEach`) removes. */
export function createFolders() {
  const folders: string[] = [];
  return {
    /** A new folder holding `files`, by forward-slash path. */
    withFiles(files: Record<string, string>): string {
      const dir = mkdtempSync(path.join(tmpdir(), 'mythos-context-'));
      folders.push(dir);
      for (const [filePath, text] of Object.entries(files)) {
        const full = path.join(dir, ...filePath.split('/'));
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, text);
      }
      return dir;
    },
    cleanUp(): void {
      for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
