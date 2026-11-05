// The content module's entry point. Every call finds the packs and reads them and the
// libraries afresh, with no cache, then validates purely over what it read (SCH-103).
import path from 'node:path';
import { type AppError, type PackSummary, type Result, err, ok } from '@mythos/contracts';
import { PackIdSchema, type Theme } from '@mythos/contracts/content';
import { cmp } from '@mythos/core';
import { toLoadedPack } from './convert';
import { listFolders, readSource, readSourceIfPresent } from './read';
import { listedThemes, packSummary } from './summaries';
import type { ContentLogger, ContentSources, LoadedPack } from './types';
import {
  BUILT_IN_LIBRARY,
  type CheckedLibraries,
  checkLibraries,
  PACK,
  type PackValidation,
  USER_LIBRARY,
  validatePack,
} from './validate';

/** Packs, libraries, and themes, read from their folders on every call. */
export type Content = {
  /** Every pack, with its issues, sorted by ID (SCH-102). */
  listPacks: () => Promise<PackSummary[]>;
  /** A pack resolved for campaign creation, or `not_found`, or `validation_failed` with every issue. */
  loadPack: (packId: string) => Promise<Result<LoadedPack, AppError>>;
  /** Every theme that can be applied (UI-031). */
  listThemes: () => Promise<Theme[]>;
};

export type CreateContentOptions = { sources: ContentSources; logger: ContentLogger };

function logLibraries(libraries: CheckedLibraries, logger: ContentLogger): void {
  for (const { id, file, shadows } of libraries.shadowings) {
    logger.warn({ id, file, shadows }, 'a user library definition replaces a built-in one');
  }
  const { files, references, invariants } = libraries.issues;
  const byFile = new Map<string, { path: string; message: string }[]>();
  for (const { file, path: at, message } of [...files, ...references, ...invariants]) {
    byFile.set(file, [...(byFile.get(file) ?? []), { path: at, message }]);
  }
  for (const [file, issues] of [...byFile].sort(([a], [b]) => cmp(a, b))) {
    logger.warn({ file, issues }, 'a library definition has problems, so no pack offers it');
  }
}

/**
 * The content module, reading from `sources`. It warns through `logger` about shadowed
 * definitions (SCH-010), duplicate pack IDs, and broken library definitions.
 */
export function createContent({ sources, logger }: CreateContentOptions): Content {
  // Pack ID to folder. A later pack folder wins a clash, with a warning (owner decision).
  async function findPacks(): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const parent of sources.packFolders) {
      for (const name of await listFolders(parent)) {
        const folder = path.join(parent, name);
        // A pack's ID is its folder name (SCH-020), so a folder that is no ID holds no pack.
        if (!PackIdSchema.safeParse(name).success) {
          logger.warn({ folder }, 'a pack folder name must be a lowercase slug, so it was skipped');
          continue;
        }
        const earlier = found.get(name);
        if (earlier !== undefined) {
          logger.warn(
            { packId: name, used: folder, ignored: earlier },
            'two pack folders have this pack',
          );
        }
        found.set(name, folder);
      }
    }
    return new Map([...found].sort(([a], [b]) => cmp(a, b)));
  }

  async function readLibraries(): Promise<CheckedLibraries> {
    const builtIn = await readSource(sources.builtInLibrary);
    const user = await readSourceIfPresent(sources.userLibrary);
    const libraries = checkLibraries(user, builtIn);
    logLibraries(libraries, logger);
    return libraries;
  }

  async function validate(folder: string, libraries: CheckedLibraries): Promise<PackValidation> {
    const validation = validatePack(await readSource(folder), libraries);
    for (const { id, file, shadows } of validation.shadowings) {
      const packId = validation.content.packId;
      logger.warn({ packId, id, file, shadows }, 'a pack definition replaces a library one');
    }
    return validation;
  }

  async function listPacks(): Promise<PackSummary[]> {
    const packs = await findPacks();
    const libraries = await readLibraries();
    const summaries: PackSummary[] = [];
    for (const folder of packs.values()) {
      const { content, issues } = await validate(folder, libraries);
      summaries.push(packSummary(content, issues));
    }
    return summaries;
  }

  // Implements SCH-102: a pack with any issue is refused.
  async function loadPack(packId: string): Promise<Result<LoadedPack, AppError>> {
    const folder = (await findPacks()).get(packId);
    if (folder === undefined) {
      return err({ code: 'not_found', message: `There is no pack "${packId}".` });
    }
    const { content, issues } = await validate(folder, await readLibraries());
    if (issues.length > 0) {
      const message = `Pack "${packId}" has problems. Fix them in its files before using it.`;
      return err({ code: 'validation_failed', message, details: { issues } });
    }
    return ok(toLoadedPack(content, sources.engineTemplates));
  }

  async function listThemes(): Promise<Theme[]> {
    const builtIn = await readSource(sources.builtInLibrary);
    const user = await readSourceIfPresent(sources.userLibrary);
    const packs: Awaited<ReturnType<typeof readSource>>[] = [];
    for (const folder of (await findPacks()).values()) packs.push(await readSource(folder));
    return listedThemes([
      { files: builtIn, label: BUILT_IN_LIBRARY },
      { files: user, label: USER_LIBRARY },
      ...packs.map((files) => ({ files, label: PACK })),
    ]);
  }

  return { listPacks, loadPack, listThemes };
}
