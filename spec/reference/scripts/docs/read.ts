/*
 * Reads what the docs check needs (OVR-037, OVR-038): requirement definitions, task
 * files, phase plans, ADRs, the markdown whose links and citations it checks, and the
 * test names and `Implements` comments in the repository's code.
 */
import { existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cmp } from '../../core/compare';
import { readPhasePlans, readTasks, type Task } from './tasks';
import { group, ID_RUN, idsIn, lineOf, readText, relPath, walk, withoutFences } from './text';

/** One requirement definition, where it is written. */
export type Requirement = {
  id: string;
  prefix: string;
  number: number;
  /** Document name without `.md`, e.g. `07-rules`. */
  doc: string;
  /** Path relative to the repository root. */
  file: string;
  line: number;
  /** Heading of the `##` or `###` section it sits in. */
  section: string;
  retired: boolean;
};

/** A requirement ID cited by a test name or an `Implements` comment. */
export type Citation = { id: string; kind: 'test' | 'code'; file: string; line: number };

/** A markdown file whose links and citations are checked. */
export type MarkdownFile = { path: string; file: string; text: string };

/** Everything the rules and the trace report work from. */
export type Docs = {
  specDir: string;
  repoRoot: string;
  /** Requirement prefix to document name, from the table in 00-overview §8.3. */
  prefixes: Map<string, string>;
  requirements: Requirement[];
  /** Two-digit document number to the section numbers its headings carry. */
  sectionNumbers: Map<string, Set<string>>;
  tasks: Task[];
  phasePlans: Map<number, string>;
  /** Three-digit numbers of the ADRs in `decisions/`. */
  adrs: Set<string>;
  markdown: MarkdownFile[];
  citations: Citation[];
};

/** Closing sections (OVR-035): they cite requirements but never define them. */
export const CLOSING_SECTIONS = new Set(['Traps', 'Decisions', 'Open']);

const CODE_ROOTS = ['apps', 'packages', 'scripts'];
const DEFINITION = /^\s*(?:- |\d+\. )?\*\*([A-Z]{2,5})-(\d{3})\*\*(.*)$/;
const HEADING = /^#{2,3} (.*)$/;
const SECTION_NUMBER = /^#{2,3} (\d+(?:\.\d+)?)\.? /;
const TEST_FILE = /\.(?:test|spec)\.tsx?$/;
const TEST_NAME = new RegExp(
  '\\b(?:it|test|describe)' +
    '(?:\\.(?:describe|only|concurrent|sequential|fails|serial|parallel))*' +
    '(?:\\.(?:each|for|skipIf|runIf)\\([\\s\\S]*?\\))?' +
    `\\(\\s*['"\`](${ID_RUN})\\s*:`,
  'g',
);
const IMPLEMENTS = new RegExp(`\\bImplements\\s+(${ID_RUN})`, 'g');

/** Reads the spec in `specDir` and the code and markdown under `repoRoot`. */
export function readDocs(specDir: string, repoRoot: string): Docs {
  const requirements: Requirement[] = [];
  const sectionNumbers = new Map<string, Set<string>>();
  for (const name of topLevelMarkdown(specDir)) {
    const path = join(specDir, name);
    const read = readRequirements(name.slice(0, -3), relPath(repoRoot, path), readText(path));
    requirements.push(...read.requirements);
    sectionNumbers.set(name.slice(0, 2), read.sectionNumbers);
  }
  const overview = join(specDir, '00-overview.md');
  const adrFiles = walk(join(specDir, 'decisions'), (name) => /^ADR-\d{3}-/.test(name));
  return {
    specDir,
    repoRoot,
    prefixes: existsSync(overview) ? readPrefixes(readText(overview)) : new Map(),
    requirements,
    sectionNumbers,
    tasks: readTasks(join(specDir, 'tasks'), (path) => relPath(repoRoot, path)),
    phasePlans: readPhasePlans(join(specDir, 'phases')),
    adrs: new Set(adrFiles.map((path) => basename(path).slice(4, 7))),
    markdown: markdownFiles(specDir, repoRoot),
    citations: readCitations(repoRoot),
  };
}

function topLevelMarkdown(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort(cmp);
}

function readPrefixes(overview: string): Map<string, string> {
  const prefixes = new Map<string, string>();
  for (const m of overview.matchAll(/^\| ([A-Z]{2,5}) \| (\d\d-[a-z-]+) \|$/gm)) {
    prefixes.set(group(m, 1), group(m, 2));
  }
  return prefixes;
}

function readRequirements(doc: string, file: string, text: string) {
  const requirements: Requirement[] = [];
  const sectionNumbers = new Set<string>();
  let section = '';
  let closing = false;
  withoutFences(text)
    .split('\n')
    .forEach((line, i) => {
      const heading = HEADING.exec(line);
      if (heading) {
        section = group(heading, 1);
        closing = closing || CLOSING_SECTIONS.has(section);
        const number = SECTION_NUMBER.exec(line);
        if (number) sectionNumbers.add(group(number, 1));
        return;
      }
      const m = closing ? null : DEFINITION.exec(line);
      if (!m) return;
      const prefix = group(m, 1);
      const number = Number(group(m, 2));
      const retired = /^\s*\(retired\b/.test(group(m, 3));
      const id = `${prefix}-${group(m, 2)}`;
      requirements.push({ id, prefix, number, doc, file, line: i + 1, section, retired });
    });
  return { requirements, sectionNumbers };
}

function markdownFiles(specDir: string, repoRoot: string): MarkdownFile[] {
  const isMarkdown = (name: string) => name.endsWith('.md');
  const paths = [
    ...topLevelMarkdown(specDir).map((name) => join(specDir, name)),
    ...['decisions', 'phases', 'tasks'].flatMap((dir) => walk(join(specDir, dir), isMarkdown)),
    join(specDir, 'reference', 'README.md'),
    join(repoRoot, 'CLAUDE.md'),
    join(repoRoot, 'README.md'),
    join(repoRoot, '.claude', 'status.md'),
    ...walk(join(repoRoot, '.claude', 'skills'), isMarkdown),
    ...CODE_ROOTS.flatMap((dir) => walk(join(repoRoot, dir), (name) => name === 'README.md')),
  ];
  return paths
    .filter((path) => existsSync(path))
    .map((path) => ({ path, file: relPath(repoRoot, path), text: readText(path) }));
}

function readCitations(repoRoot: string): Citation[] {
  const sources = CODE_ROOTS.flatMap((dir) =>
    walk(join(repoRoot, dir), (name) => /\.tsx?$/.test(name)),
  );
  return sources.flatMap((path) => {
    const text = readText(path);
    const file = relPath(repoRoot, path);
    const tests = TEST_FILE.test(path) ? collect(text, TEST_NAME, 'test', file) : [];
    return [...tests, ...collect(text, IMPLEMENTS, 'code', file)];
  });
}

function collect(text: string, pattern: RegExp, kind: Citation['kind'], file: string) {
  return [...text.matchAll(pattern)].flatMap((m) =>
    idsIn(group(m, 1)).map((id): Citation => ({ id, kind, file, line: lineOf(text, m.index) })),
  );
}
