// The spec check: the repository's copies of the spec's fixtures, contracts, and server
// types must match their sources byte for byte (OVR-030, OVR-033). `pnpm check` runs it;
// it prints every difference, then exits 1 if there are any.
//
// Usage: tsx scripts/check-spec.ts [repoRoot]
//
// Bytes are compared as they are. `.gitattributes` checks text out with LF on every OS,
// so a Windows checkout matches too.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** A folder in `spec/` and the repository folder that copies it. Paths use `/`. */
type CopyRule = {
  source: string;
  copy: string;
  /** Whether the copy may hold files the source does not have. */
  extrasAllowed: boolean;
  /** Files left out on both sides. */
  skip: (file: string) => boolean;
};

const skipNothing = (): boolean => false;
const isTest = (file: string): boolean => file.endsWith('.test.ts');

const copyRules: readonly CopyRule[] = [
  // Implements OVR-030. Extra files are allowed, such as the engine's prompt templates
  // in content-library/templates/ (CTX-004), which have no fixture.
  {
    source: 'spec/fixtures/library',
    copy: 'content-library',
    extrasAllowed: true,
    skip: skipNothing,
  },
  {
    source: 'spec/fixtures/packs/reference',
    copy: 'content-packs/reference',
    extrasAllowed: true,
    skip: skipNothing,
  },
  // Implements OVR-033: the same files in both directions, tests excluded.
  {
    source: 'spec/reference/contracts',
    copy: 'packages/contracts/src',
    extrasAllowed: false,
    skip: isTest,
  },
];

// Implements OVR-033 for server types copied whole. Each entry, `<module>/<file>`, is
// spec/reference/server-types/<module>/<file>, copied to apps/server/src/modules/<module>/<file>.
// A file that adds an implementation after the verbatim types, such as the job queue's
// queue.ts, is not a pure copy and is not listed.
const serverTypeCopies: readonly string[] = ['providers/types.ts'];

/** A single file in `spec/` and the repository file that copies it. Paths use `/`. */
type FileCopyRule = { source: string; copy: string };

const fileCopyRules: readonly FileCopyRule[] = serverTypeCopies.map((file) => ({
  source: `spec/reference/server-types/${file}`,
  copy: `apps/server/src/modules/${file}`,
}));

/** Lists the files under `dir`, sorted, as `/`-separated paths relative to it. */
function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .map((file) => file.split(path.sep).join('/'))
    .sort();
}

/**
 * Compares one copy with its source and describes each difference, naming the files.
 * Returns the number of source files compared, for the summary line.
 */
function compareCopy(repoRoot: string, rule: CopyRule): { files: number; problems: string[] } {
  if (!existsSync(path.join(repoRoot, rule.source))) {
    return { files: 0, problems: [`${rule.source} is missing, so ${rule.copy} cannot be checked`] };
  }
  const sourceFiles = listFiles(path.join(repoRoot, rule.source)).filter((f) => !rule.skip(f));
  const copyFiles = listFiles(path.join(repoRoot, rule.copy)).filter((f) => !rule.skip(f));
  const inCopy = new Set(copyFiles);
  const inSource = new Set(sourceFiles);
  const problems: string[] = [];

  for (const file of sourceFiles) {
    const source = `${rule.source}/${file}`;
    const copy = `${rule.copy}/${file}`;
    if (!inCopy.has(file)) {
      problems.push(`${copy} is missing: copy it from ${source}`);
    } else if (!readBytes(repoRoot, copy).equals(readBytes(repoRoot, source))) {
      problems.push(`${copy} differs from ${source}`);
    }
  }
  if (!rule.extrasAllowed) {
    for (const file of copyFiles.filter((f) => !inSource.has(f))) {
      problems.push(`${rule.copy}/${file} has no source: ${rule.source}/${file} does not exist`);
    }
  }
  return { files: sourceFiles.length, problems };
}

/** Compares one copied file with its source, naming both in any problem. */
function compareFile(repoRoot: string, rule: FileCopyRule): string[] {
  if (!existsSync(path.join(repoRoot, rule.source))) {
    return [`${rule.source} is missing, so ${rule.copy} cannot be checked`];
  }
  if (!existsSync(path.join(repoRoot, rule.copy))) {
    return [`${rule.copy} is missing: copy it from ${rule.source}`];
  }
  if (!readBytes(repoRoot, rule.copy).equals(readBytes(repoRoot, rule.source))) {
    return [`${rule.copy} differs from ${rule.source}`];
  }
  return [];
}

function readBytes(repoRoot: string, file: string): Buffer {
  return readFileSync(path.join(repoRoot, file));
}

const repoRoot =
  process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results = copyRules.map((rule) => ({ rule, ...compareCopy(repoRoot, rule) }));
const problems = [
  ...results.flatMap((result) => result.problems),
  ...fileCopyRules.flatMap((rule) => compareFile(repoRoot, rule)),
];

for (const problem of problems) console.log(problem);
if (problems.length > 0) {
  console.log(
    `\nSpec check failed: ${String(problems.length)} difference(s). Copy the file from ` +
      'spec/ again; never edit a copy (OVR-030, OVR-033).',
  );
  process.exit(1);
}
const counts = [
  ...results.map((result) => `${result.rule.copy} (${String(result.files)} files)`),
  `${String(fileCopyRules.length)} server type file(s)`,
];
console.log(`Spec check passed: ${counts.join(', ')} match their sources.`);
