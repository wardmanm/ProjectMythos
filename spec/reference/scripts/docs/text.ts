/*
 * Small text and file helpers shared by the docs check (OVR-038).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cmp } from '../../core/compare';

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

/** A requirement ID, or several joined by commas, `and`, `&`, or `/`. */
export const ID_RUN = '[A-Z]{2,5}-\\d{3}(?:\\s*(?:,\\s*and|,|and|&|/)\\s*[A-Z]{2,5}-\\d{3})*';

/** Capture group `i` of a match, or an empty string. */
export function group(match: RegExpMatchArray | RegExpExecArray, i: number): string {
  return match[i] ?? '';
}

/** Every requirement-shaped ID in a piece of text, in order. */
export function idsIn(text: string): string[] {
  return text.match(/\b[A-Z]{2,5}-\d{3}\b/g) ?? [];
}

/** 1-based line number of a character offset. */
export function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

/** The text with fenced code blocks blanked out, keeping every line where it was. */
export function withoutFences(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (block) =>
    block.replace(/[^\n]/g, ''),
  );
}

/** A file's text with Windows line endings normalized. */
export function readText(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

/** Path from the repository root, with forward slashes on every OS. */
export function relPath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).split('\\').join('/');
}

/** Files under `dir` whose names pass `keep`, sorted, skipping dependency and build folders. */
export function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort(cmp)
    .flatMap((name) => {
      if (SKIPPED_DIRS.has(name)) return [];
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return walk(path, keep);
      return keep(name) ? [path] : [];
    });
}
