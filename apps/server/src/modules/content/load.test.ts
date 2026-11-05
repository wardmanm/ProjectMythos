import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { type AppError, PackIssueSchema, type Result } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContent } from './load';
import { defaultSources } from './sources';
import {
  breakReferencePack,
  BUILT_IN_LIBRARY_DIR,
  copyReferencePack,
  EIGHT_BREAKS,
  recordingLogger,
  REFERENCE_PACK_DIR,
  removeTempDirs,
  replaceInFile,
  tempDir,
} from './test-pack';
import type { ContentSources, PackIssue } from './types';

afterEach(removeTempDirs);

/** Content over a fresh data directory, which holds only what the test puts there. */
function setUp(options: { repositoryPacks?: boolean } = {}) {
  const dataDir = tempDir();
  const defaults = defaultSources(dataDir);
  const sources: ContentSources =
    options.repositoryPacks === false
      ? { ...defaults, packFolders: [path.join(dataDir, 'content-packs')] }
      : defaults;
  const logger = recordingLogger();
  return { dataDir, logger, content: createContent({ sources, logger }) };
}

const DetailsSchema = z.object({ issues: z.array(PackIssueSchema) });

function issuesOf<T>(result: Result<T, AppError>): PackIssue[] {
  if (result.ok) return [];
  expect(result.error.code).toBe('validation_failed');
  return DetailsSchema.parse(result.error.details).issues;
}

/** Every file under `root` with its bytes and modification time. */
function snapshot(root: string): Record<string, { bytes: string; mtimeMs: number }> {
  const files: Record<string, { bytes: string; mtimeMs: number }> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[file] = { bytes: readFileSync(file).toString('base64'), mtimeMs: statSync(file).mtimeMs };
  }
  return files;
}

describe('createContent', () => {
  it('SCH-010: the reference pack is listed with no issues', async () => {
    const { content, logger } = setUp();
    const packs = await content.listPacks();
    expect(packs.map((pack) => [pack.packId, pack.issues])).toEqual([['reference', []]]);
    expect(logger.warnings).toEqual([]);
  });

  it('SCH-010: a pack in the data directory replaces the repository pack with its ID, with a warning', async () => {
    const { content, dataDir, logger } = setUp();
    const packDir = copyReferencePack(dataDir);
    replaceInFile(path.join(packDir, 'pack.json'), '"version": "0.1.0"', '"version": "0.2.0"');
    const packs = await content.listPacks();
    expect(packs.map((pack) => pack.version)).toEqual(['0.2.0']);
    expect(logger.warnings.map((warning) => warning.message)).toEqual([
      'two pack folders have this pack',
    ]);
    expect(logger.warnings[0]?.fields).toMatchObject({ packId: 'reference', used: packDir });
  });

  it('SCH-010: a pack ruleset.standard wins, and a warning is logged', async () => {
    const { content, dataDir, logger } = setUp({ repositoryPacks: false });
    const packDir = copyReferencePack(dataDir);
    const standard = readFileSync(
      path.join(BUILT_IN_LIBRARY_DIR, 'rulesets', 'ruleset.standard.json'),
      'utf8',
    );
    mkdirSync(path.join(packDir, 'rulesets'));
    writeFileSync(
      path.join(packDir, 'rulesets', 'ruleset.standard.json'),
      standard.replace('"Standard"', '"Brinemoor Rules"'),
    );
    const loaded = await content.loadPack('reference');
    if (!loaded.ok) throw new Error(loaded.error.message);
    expect(
      loaded.value.rulesets.find((ruleset) => ruleset.definition.id === 'ruleset.standard'),
    ).toMatchObject({
      source: 'pack',
      definition: { name: 'Brinemoor Rules' },
    });
    expect(logger.warnings).toEqual([
      {
        message: 'a pack definition replaces a library one',
        fields: {
          packId: 'reference',
          id: 'ruleset.standard',
          file: 'rulesets/ruleset.standard.json',
          shadows: 'content-library/rulesets/ruleset.standard.json',
        },
      },
    ]);
  });

  it("SCH-012: a ruleset in the user library's rulesets/ is offered", async () => {
    const { content, dataDir } = setUp();
    const standard = readFileSync(
      path.join(BUILT_IN_LIBRARY_DIR, 'rulesets', 'ruleset.standard.json'),
      'utf8',
    );
    mkdirSync(path.join(dataDir, 'library', 'rulesets'), { recursive: true });
    writeFileSync(
      path.join(dataDir, 'library', 'rulesets', 'ruleset.house.json'),
      standard.replace('"ruleset.standard"', '"ruleset.house"'),
    );
    const [reference] = await content.listPacks();
    expect(reference?.rulesets.map((option) => option.id)).toContain('ruleset.house');
  });

  it('SCH-003: canon and openings come from their Markdown files', async () => {
    const { content } = setUp();
    const loaded = await content.loadPack('reference');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const packDir = REFERENCE_PACK_DIR;
    const varek = loaded.value.entities.find(({ entity }) => entity.id === 'npc.varek');
    expect(varek?.canon).toBe(
      readFileSync(path.join(packDir, 'entities', 'characters', 'npc.varek.md'), 'utf8'),
    );
    expect(loaded.value.scenarios[0]?.opening).toBe(
      readFileSync(path.join(packDir, 'scenarios', 'arrival.md'), 'utf8'),
    );
  });

  it("SCH-004: loading leaves every file's bytes and mtime unchanged", async () => {
    const { content, dataDir } = setUp({ repositoryPacks: false });
    copyReferencePack(dataDir);
    const before = snapshot(dataDir);
    const libraryBefore = snapshot(BUILT_IN_LIBRARY_DIR);
    await content.listPacks();
    await content.loadPack('reference');
    await content.listThemes();
    expect(snapshot(dataDir)).toEqual(before);
    expect(snapshot(BUILT_IN_LIBRARY_DIR)).toEqual(libraryBefore);
  });

  it("SCH-023: the pack's, tone profile's, ruleset's, and engine's templates folders are absolute paths", async () => {
    const { content, dataDir } = setUp({ repositoryPacks: false });
    const packDir = copyReferencePack(dataDir);
    mkdirSync(path.join(packDir, 'templates'));
    mkdirSync(path.join(packDir, 'tone-profiles', 'tone.coastal-mystery', 'templates'), {
      recursive: true,
    });
    const rulesets = path.join(dataDir, 'library', 'rulesets');
    mkdirSync(path.join(rulesets, 'ruleset.house', 'templates'), { recursive: true });
    const standard = readFileSync(
      path.join(BUILT_IN_LIBRARY_DIR, 'rulesets', 'ruleset.standard.json'),
      'utf8',
    );
    writeFileSync(
      path.join(rulesets, 'ruleset.house.json'),
      standard.replace('"ruleset.standard"', '"ruleset.house"'),
    );
    const loaded = await content.loadPack('reference');
    if (!loaded.ok) throw new Error(loaded.error.message);
    const { templates, toneProfiles, rulesets: offered } = loaded.value;
    const tone = toneProfiles.find(({ definition }) => definition.id === 'tone.coastal-mystery');
    const house = offered.find(({ definition }) => definition.id === 'ruleset.house');
    const folders = [templates.pack, tone?.templatesDir, house?.templatesDir, templates.engine];
    expect(folders).toEqual([
      path.join(packDir, 'templates'),
      path.join(packDir, 'tone-profiles', 'tone.coastal-mystery', 'templates'),
      path.join(rulesets, 'ruleset.house', 'templates'),
      path.join(BUILT_IN_LIBRARY_DIR, 'templates'),
    ]);
    expect(
      folders.every((folder) => folder !== undefined && folder !== null && path.isAbsolute(folder)),
    ).toBe(true);
  });

  it('SCH-100, SCH-101: eight breaks are each reported with file, path, and message', async () => {
    const { content, dataDir } = setUp({ repositoryPacks: false });
    breakReferencePack(copyReferencePack(dataDir));
    const [summary] = await content.listPacks();
    expect(summary?.issues).toEqual(EIGHT_BREAKS);
  });

  it('SCH-100: file issues come before reference issues, which come before invariants', async () => {
    const { content, dataDir } = setUp({ repositoryPacks: false });
    breakReferencePack(copyReferencePack(dataDir));
    const issues = (await content.listPacks())[0]?.issues ?? [];
    const position = (pathInFile: string) => issues.findIndex((issue) => issue.path === pathInFile);
    // In file order alone, the ledger's typo would come after Wren and the boots.
    expect(position('wieght')).toBeLessThan(position('startingLocationId'));
    expect(position('themeId')).toBeLessThan(position('stats'));
    expect(position('entries.2.claim.aboutRef')).toBeLessThan(position('startingLocation'));
  });

  it('SCH-102: a broken pack is listed with its issues, and loadPack refuses it', async () => {
    const { content, dataDir } = setUp({ repositoryPacks: false });
    breakReferencePack(copyReferencePack(dataDir));
    const [summary] = await content.listPacks();
    expect(summary?.packId).toBe('reference');
    expect(issuesOf(await content.loadPack('reference'))).toEqual(EIGHT_BREAKS);
  });

  it('SCH-102: an unknown pack is not_found', async () => {
    const { content } = setUp();
    const result = await content.loadPack('atlantis');
    expect(result.ok ? null : result.error.code).toBe('not_found');
  });

  it('SCH-103: loading twice gives deep-equal results', async () => {
    const { content } = setUp();
    expect(await content.loadPack('reference')).toEqual(await content.loadPack('reference'));
    expect(await content.listPacks()).toEqual(await content.listPacks());
  });

  it('UI-031: a pack theme below contrast is an issue, and listThemes leaves it out', async () => {
    const { content, dataDir } = setUp({ repositoryPacks: false });
    const packDir = copyReferencePack(dataDir);
    const brine = readFileSync(
      path.join(BUILT_IN_LIBRARY_DIR, 'themes', 'theme.brine.json'),
      'utf8',
    );
    const dim = brine
      .replace('"theme.brine"', '"theme.dim"')
      .replace(/"textMuted": "#[0-9a-fA-F]{6}"/g, '"textMuted": "#555555"');
    mkdirSync(path.join(packDir, 'themes'));
    writeFileSync(path.join(packDir, 'themes', 'theme.dim.json'), dim);
    const [summary] = await content.listPacks();
    expect(summary?.issues.map((issue) => issue.file)).toContain('themes/theme.dim.json');
    const themes = await content.listThemes();
    expect(themes.map((theme) => theme.id)).not.toContain('theme.dim');
    expect(themes).toHaveLength(6);
  });

  it('SCH-102: a folder whose name is not a pack ID is skipped with a warning', async () => {
    const { content, dataDir, logger } = setUp({ repositoryPacks: false });
    mkdirSync(path.join(dataDir, 'content-packs', 'My Pack'), { recursive: true });
    expect(await content.listPacks()).toEqual([]);
    expect(logger.warnings.map((warning) => warning.message)).toEqual([
      'a pack folder name must be a lowercase slug, so it was skipped',
    ]);
  });
});
