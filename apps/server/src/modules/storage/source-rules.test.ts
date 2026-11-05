// Rules about where code may do things, checked by reading the source. Lint cannot
// say "only this file", so these are tests.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmp } from '@mythos/core';
import { describe, expect, it } from 'vitest';

const storageDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(storageDir, '../../../../..');

/** Every .ts and .tsx file under `dir`, as paths relative to the repository, with `/`. */
function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') found.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path.relative(repoRoot, full).split(path.sep).join('/'));
    }
  }
  return found.sort(cmp);
}

const read = (file: string) => readFileSync(path.join(repoRoot, file), 'utf8');
const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const codeRoots = ['apps', 'packages', 'scripts'].map((dir) => path.join(repoRoot, dir));
const storage = 'apps/server/src/modules/storage';

describe('source rules', () => {
  it('CONV-055: only storage/sqlite.ts imports node:sqlite', () => {
    const importsSqlite = /\bfrom\s+['"]node:sqlite['"]|\bimport\(\s*['"]node:sqlite['"]/;
    const importers = codeRoots
      .flatMap(sourceFiles)
      .filter((file) => importsSqlite.test(read(file)));
    expect(importers).toEqual([`${storage}/sqlite.ts`]);
  });

  it('ARCH-040: only the commit path writes branch_turns, commit_sets.active, or replay_conflicts', () => {
    const projectionWrite =
      /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|REPLACE\s+INTO|DELETE\s+FROM|UPDATE)\s+(?:branch_turns|replay_conflicts)\b|\bUPDATE\s+commit_sets\b/i;
    const writers = sourceFiles(path.join(repoRoot, 'apps/server/src'))
      .filter((file) => !isTest(file))
      .filter((file) => projectionWrite.test(read(file)));
    const allowed = ['branches.ts', 'rebuild.ts', 'turns.ts'].map((file) => `${storage}/${file}`);
    expect(writers.filter((file) => !allowed.includes(file))).toEqual([]);
  });

  it('CONV-116: storage tests make their databases in fresh os.tmpdir() folders and close them', () => {
    const tests = sourceFiles(path.join(repoRoot, storage))
      .filter(isTest)
      .filter((file) => !file.endsWith('/source-rules.test.ts'));
    for (const file of tests) {
      const text = read(file);
      // Folders and databases come only from testing.ts's createTestSpace…
      expect(text, file).not.toMatch(/mkdtemp|new DatabaseSync|createCampaignStore\(/);
      // …whose cleanUp, after every test, closes each database before removing its folder.
      if (/openDatabase\(|\.store\(|newTestCampaign\(/.test(text)) {
        expect(text, file).toMatch(/afterEach\(\(\) => \{\s*space\.cleanUp\(\);/);
      }
    }
    expect(read(`${storage}/testing.ts`)).toMatch(/mkdtempSync\(path\.join\(tmpdir\(\)/);
  });
});
