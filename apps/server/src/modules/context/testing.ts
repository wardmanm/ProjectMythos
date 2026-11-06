// Helpers for this module's tests only: the standard ruleset, layers held in memory, and
// temporary folders in os.tmpdir() (CONV-116). Not exported from index.ts.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Ruleset, RulesetSchema } from '@mythos/contracts/content';
import type { CanonTemplate, SnapshotTemplateLayer } from '../storage';
import { layeredLookup, type TemplateLookup } from './templates';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The built-in library's standard ruleset. */
export function standardRuleset(): Ruleset {
  const file = path.join(repositoryRoot, 'content-library', 'rulesets', 'ruleset.standard.json');
  return RulesetSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
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
