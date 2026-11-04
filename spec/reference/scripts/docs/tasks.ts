/*
 * Reads task files and phase plans for the docs check (OVR-037, OVR-038).
 */
import { basename } from 'node:path';
import { group, ID_RUN, idsIn, readText, walk } from './text';

/** One task file, as the docs check sees it. */
export type Task = {
  id: string;
  phase: number;
  file: string;
  title: string;
  status: string;
  dependsOn: string[];
  requirements: string[];
  /** Text of each completion-notes part, keyed by its label; missing parts are absent. */
  notes: Map<string, string>;
  /** True while the completion notes still hold the template line. */
  notesTemplate: boolean;
  /** IDs that lead an entry under Not tested, such as `RUL-014: checked by hand`. */
  notTested: string[];
};

/** The five parts of the completion notes, in order (CONV-135). */
export const NOTES_PARTS = ['Done', 'Rulings', 'Pending decisions', 'Not tested', 'Dependencies'];

/** The first line of the completion-notes template; a done task has replaced it. */
export const TEMPLATE_LINE = '_Written when the task is done';

const TASK_FILE = /^P(\d+)-T(\d+)-[a-z0-9-]+\.md$/;

/** Reads every task file in `dir`. */
export function readTasks(dir: string, rel: (path: string) => string): Task[] {
  return walk(dir, (name) => TASK_FILE.test(name)).map((path) => readTask(path, rel(path)));
}

/** Phase number to the text of its plan, for every `phase-N.md` in `dir`. */
export function readPhasePlans(dir: string): Map<number, string> {
  const plans = new Map<number, string>();
  for (const path of walk(dir, (name) => /^phase-\d+\.md$/.test(name))) {
    plans.set(Number(/(\d+)\.md$/.exec(path)?.[1]), readText(path));
  }
  return plans;
}

function readTask(path: string, file: string): Task {
  const text = readText(path);
  const name = TASK_FILE.exec(basename(path));
  const notesText = sectionOf(text, 'Completion notes');
  const notes = notesParts(notesText);
  return {
    id: name ? `P${group(name, 1)}-T${group(name, 2)}` : basename(path),
    phase: name ? Number(group(name, 1)) : 0,
    file,
    title: /^# P\d+-T\d+: (.*)$/m.exec(text)?.[1] ?? '',
    status: headerCell(text, 'Status'),
    dependsOn: expandDepends(headerCell(text, 'Depends on')),
    requirements: listedRequirements(sectionOf(text, 'Requirements')),
    notes,
    notesTemplate: notesText.includes(TEMPLATE_LINE),
    notTested: leadingIds(notes.get('Not tested') ?? ''),
  };
}

function headerCell(text: string, name: string): string {
  const m = new RegExp(`^\\| \\*\\*${name}\\*\\* \\| (.*?) \\|$`, 'm').exec(text);
  return m ? group(m, 1).trim() : '';
}

/** The body of a `## heading` section, up to the next `##` heading. */
function sectionOf(text: string, heading: string): string {
  const marker = `\n## ${heading}\n`;
  const start = text.indexOf(marker);
  if (start === -1) return '';
  const rest = text.slice(start + marker.length);
  const end = rest.search(/^## /m);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every ID after the section's first paragraph, which is the standing introduction. */
function listedRequirements(section: string): string[] {
  const paragraphs = section.trim().split(/\n\s*\n/);
  return paragraphs.slice(1).flatMap(idsIn);
}

/** `—`, a list (`P1-T11, P1-T12`), or a range (`P1-T01 to P1-T26`). */
function expandDepends(cell: string): string[] {
  const range = /^(P\d+-T)(\d+) to P\d+-T(\d+)$/.exec(cell);
  if (!range) return [...cell.matchAll(/P\d+-T\d+/g)].map((m) => m[0]);
  const ids: string[] = [];
  for (let n = Number(group(range, 2)); n <= Number(group(range, 3)); n++) {
    ids.push(`${group(range, 1)}${String(n).padStart(2, '0')}`);
  }
  return ids;
}

/** Splits the notes into their `- **Part:**` bullets; each part runs to the next. */
function notesParts(notes: string): Map<string, string> {
  const parts = new Map<string, string>();
  const labels = NOTES_PARTS.join('|');
  const pattern = new RegExp(
    `^- \\*\\*(${labels}):\\*\\*([\\s\\S]*?)(?=^- \\*\\*(?:${labels}):\\*\\*|(?![\\s\\S]))`,
    'gm',
  );
  for (const m of notes.matchAll(pattern)) parts.set(group(m, 1), group(m, 2).trim());
  return parts;
}

/** IDs that start an entry, `RUL-014: reason` or `RUL-014, RUL-015: reason`. */
function leadingIds(part: string): string[] {
  const entry = new RegExp(`(?:^|[\\n;])\\s*(?:- )?(${ID_RUN})\\s*:\\s*\\S`, 'g');
  return [...part.matchAll(entry)].flatMap((m) => idsIn(group(m, 1)));
}
