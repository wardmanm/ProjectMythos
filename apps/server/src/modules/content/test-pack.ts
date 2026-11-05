// Test support for this module's tests only: the reference pack and the built-in library, in
// memory or copied to a temp folder, with helpers that change one file at a time.
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmp } from '@mythos/core';
import { readSource } from './read';
import type { ContentLogger, PackIssue, SourceFiles } from './types';
import {
  type CheckedLibraries,
  checkLibraries,
  type PackValidation,
  validatePack,
} from './validate';

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url));

/** The repository's reference pack and built-in library. */
export const REFERENCE_PACK_DIR = path.join(repositoryRoot, 'content-packs', 'reference');
export const BUILT_IN_LIBRARY_DIR = path.join(repositoryRoot, 'content-library');

/** A source with no files, such as an empty user library. */
export function emptySource(root: string): SourceFiles {
  return { root, files: new Map(), templateDirs: [] };
}

/** The reference pack, the built-in library, and an empty user library, read from the repository. */
export async function referenceSources(): Promise<{
  pack: SourceFiles;
  user: SourceFiles;
  builtIn: SourceFiles;
}> {
  return {
    pack: await readSource(REFERENCE_PACK_DIR),
    user: emptySource(path.join(tmpdir(), 'no-user-library')),
    builtIn: await readSource(BUILT_IN_LIBRARY_DIR),
  };
}

/** `source` with one file set to `text`, added in `cmp` order if it was not there, as `readSource` would. */
export function withFile(source: SourceFiles, relative: string, text: string): SourceFiles {
  const files = new Map([...source.files, [relative, text]]);
  return { ...source, files: new Map([...files].sort(([a], [b]) => cmp(a, b))) };
}

/** `source` with one file removed. */
export function withoutFile(source: SourceFiles, relative: string): SourceFiles {
  const files = new Map(source.files);
  files.delete(relative);
  return { ...source, files };
}

/** `source` with `from` replaced by `to` in one file. Throws if `from` is not there. */
export function withReplaced(
  source: SourceFiles,
  relative: string,
  from: string,
  to: string,
): SourceFiles {
  const text = source.files.get(relative);
  if (text === undefined || !text.includes(from)) {
    throw new Error(`${relative} does not contain ${from}`);
  }
  return withFile(source, relative, text.replace(from, to));
}

/** `source` with templates folders noted, as `readSource` notes them. */
export function withTemplateDirs(source: SourceFiles, dirs: readonly string[]): SourceFiles {
  return { ...source, templateDirs: [...source.templateDirs, ...dirs] };
}

/** Validates a pack against libraries, the user library empty unless given. */
export function validate(
  pack: SourceFiles,
  builtIn: SourceFiles,
  user: SourceFiles = emptySource(path.join(tmpdir(), 'no-user-library')),
): PackValidation & { libraries: CheckedLibraries } {
  const libraries = checkLibraries(user, builtIn);
  return { ...validatePack(pack, libraries), libraries };
}

/** The issues in one file, without the file name, for short assertions. */
export function issuesIn(
  issues: readonly PackIssue[],
  file: string,
): { path: string; message: string }[] {
  return issues
    .filter((issue) => issue.file === file)
    .map(({ path: at, message }) => ({ path: at, message }));
}

/** A logger that keeps every warning, for assertions. */
export function recordingLogger(): ContentLogger & {
  warnings: { fields: Record<string, unknown>; message: string }[];
} {
  const warnings: { fields: Record<string, unknown>; message: string }[] = [];
  return { warnings, warn: (fields, message) => warnings.push({ fields, message }) };
}

/** A new, empty temp folder, which `removeTempDirs` deletes. */
const tempDirs: string[] = [];
export function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'mythos-content-'));
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Copies the reference pack to `<dataDir>/content-packs/reference/` and returns that folder. */
export function copyReferencePack(dataDir: string): string {
  const packDir = path.join(dataDir, 'content-packs', 'reference');
  cpSync(REFERENCE_PACK_DIR, packDir, { recursive: true });
  return packDir;
}

/** Replaces `from` with `to` in a file on disk. Throws if `from` is not there. */
export function replaceInFile(file: string, from: string, to: string): void {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${file} does not contain ${from}`);
  writeFileSync(file, text.replace(from, to));
}

/** The eight breaks used to test the reference checker, each where no other hides it. */
export function breakReferencePack(packDir: string): void {
  const at = (relative: string) => path.join(packDir, ...relative.split('/'));
  replaceInFile(
    at('entities/items/item.harbor-ledger.json'),
    '"size": "small"',
    '"size": "small", "wieght": 1',
  );
  replaceInFile(at('entities/characters/npc.tomas.json'), '"place.harbor"', '"place.nowhere"');
  replaceInFile(
    at('entities/items/item.coins.json'),
    '"size": "tiny"',
    '"size": "tiny", "quantity": 3',
  );
  replaceInFile(at('entities/items/item.boots.json'), '"slot": "feet"', '"slot": "belt"');
  replaceInFile(at('entities/characters/pc.wren.json'), '"str": 2', '"str": 3');
  replaceInFile(at('history.json'), '"aboutRef": "merrow-lost"', '"aboutRef": "merrow-gone"');
  replaceInFile(
    at('relationships.json'),
    '"trust": 3, "affection": 2',
    '"trusst": 3, "affection": 2',
  );
  replaceInFile(at('tone-profiles/tone.coastal-mystery.json'), '"theme.brine"', '"theme.briny"');
}

export const EIGHT_BREAKS: PackIssue[] = [
  // Pass 1: files.
  {
    file: 'entities/items/item.harbor-ledger.json',
    path: 'wieght',
    message: 'unknown key "wieght"',
  },
  // Pass 2: references.
  {
    file: 'entities/characters/npc.tomas.json',
    path: 'startingLocationId',
    message: '"place.nowhere" is not an entity in this pack',
  },
  {
    file: 'history.json',
    path: 'entries.2.claim.aboutRef',
    message: '"merrow-gone" is not the ref of an entry in this file',
  },
  {
    file: 'tone-profiles/tone.coastal-mystery.json',
    path: 'themeId',
    message: '"theme.briny" is not a theme in the pack or the libraries',
  },
  // Pass 3: invariants.
  {
    file: 'entities/characters/pc.wren.json',
    path: 'stats',
    message: 'the ratings add up to 16; a new PC in ruleset.standard has 15 points',
  },
  {
    file: 'entities/items/item.boots.json',
    path: 'startingLocation',
    message: 'there is no "belt" slot',
  },
  {
    file: 'entities/items/item.coins.json',
    path: 'startingLocation',
    message: 'wool trousers has room for 2 more; coins needs 3',
  },
  {
    file: 'relationships.json',
    path: 'relationships.0.dimensions.trusst',
    message: '"trusst" is not a dimension in ruleset.standard',
  },
];
