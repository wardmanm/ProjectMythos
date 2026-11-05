// Reads a pack or library folder into memory, so that validation is pure (SCH-103). Only
// reading happens here: content files are never written (SCH-004).
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { cmp } from '@mythos/core';
import type { SourceFiles } from './types';

/** Pack-root folders holding files that are not JSON or Markdown content (MED-029, UI-034). */
const SKIPPED_AT_ROOT = new Set(['media', 'fonts']);

/** Text as every OS should see it: LF line endings and no BOM (CONV-083). */
export function normalizeText(text: string): string {
  const withoutBom = text.startsWith('﻿') ? text.slice(1) : text;
  return withoutBom.replace(/\r\n?/g, '\n');
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

// Directory listings come back in a different order on each OS, so sort them (CONV-087).
async function listSorted(dir: string): Promise<Dirent[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.sort((a, b) => cmp(a.name, b.name));
}

type Found = { files: [string, string][]; templateDirs: string[] };

async function walk(root: string, parts: readonly string[], found: Found): Promise<void> {
  for (const entry of await listSorted(path.join(root, ...parts))) {
    // Dot-files and dot-folders (.git, .DS_Store) are never content.
    if (entry.name.startsWith('.')) continue;
    const childParts = [...parts, entry.name];
    const relative = childParts.join('/');
    if (entry.isDirectory()) {
      // Templates are read by whoever renders them (P1-T17, P1-T18); only their folder is noted.
      if (entry.name === 'templates') found.templateDirs.push(relative);
      else if (!(parts.length === 0 && SKIPPED_AT_ROOT.has(entry.name))) {
        await walk(root, childParts, found);
      }
    } else if (entry.isFile() && /\.(json|md)$/.test(entry.name)) {
      const text = await readFile(path.join(root, ...childParts), 'utf8');
      found.files.push([relative, normalizeText(text)]);
    }
  }
}

/**
 * Reads every `.json` and `.md` file under `root` into memory, keyed by forward-slash
 * relative path in `cmp` order, and notes each `templates/` folder without reading it.
 * Throws when `root` does not exist. Implements SCH-103.
 */
export async function readSource(root: string): Promise<SourceFiles> {
  const found: Found = { files: [], templateDirs: [] };
  await walk(root, [], found);
  found.files.sort(([a], [b]) => cmp(a, b));
  found.templateDirs.sort(cmp);
  return { root, files: new Map(found.files), templateDirs: found.templateDirs };
}

/** Like `readSource`, but a folder that does not exist reads as empty. */
export async function readSourceIfPresent(root: string): Promise<SourceFiles> {
  try {
    await stat(root);
  } catch (error) {
    if (isMissing(error)) return { root, files: new Map(), templateDirs: [] };
    throw error;
  }
  return readSource(root);
}

/** The names of the folders inside `folder`, sorted with `cmp`; none when it does not exist. */
export async function listFolders(folder: string): Promise<string[]> {
  try {
    const entries = await listSorted(folder);
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
