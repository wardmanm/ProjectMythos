/*
 * The rules of the docs check (OVR-038). Each function returns one message per
 * problem, starting with the file and, where there is one, the line.
 */
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Docs, MarkdownFile, Requirement } from './read';
import { NOTES_PARTS, type Task } from './tasks';
import { group, lineOf, withoutFences } from './text';

/** Prefixes for rules about code and process, met by `pnpm check` and review, not named tests. */
export const STRUCTURAL_PREFIXES = new Set(['OVR', 'CONV']);

/** The only values a task's Status row may hold (OVR-037). */
export const STATUSES = ['Not started', 'Done'];

/** Every problem the docs check finds, grouped by rule. */
export function checkDocs(docs: Docs): string[] {
  return [
    ...checkDefinitions(docs),
    ...checkCitedIds(docs),
    ...docs.markdown.flatMap((md) => checkReferences(docs, md)),
    ...checkTasks(docs),
  ];
}

/** The first definition of each ID, keyed by ID. */
export function definitions(docs: Docs): Map<string, Requirement> {
  const byId = new Map<string, Requirement>();
  for (const r of docs.requirements) if (!byId.has(r.id)) byId.set(r.id, r);
  return byId;
}

/** IDs cited by at least one test name. */
export function testedIds(docs: Docs): Set<string> {
  return new Set(docs.citations.filter((c) => c.kind === 'test').map((c) => c.id));
}

/** Tasks not started whose dependencies are all done, in task order. */
export function readyTasks(docs: Docs): Task[] {
  const status = new Map(docs.tasks.map((t) => [t.id, t.status]));
  return docs.tasks.filter(
    (t) => t.status === 'Not started' && t.dependsOn.every((dep) => status.get(dep) === 'Done'),
  );
}

function checkDefinitions(docs: Docs): string[] {
  const problems: string[] = [];
  const first = new Map<string, Requirement>();
  const lastInSection = new Map<string, number>();
  for (const r of docs.requirements) {
    const at = `${r.file}:${r.line}`;
    const earlier = first.get(r.id);
    if (earlier)
      problems.push(`${at}: ${r.id} is already defined at ${earlier.file}:${earlier.line}`);
    else first.set(r.id, r);
    const home = docs.prefixes.get(r.prefix);
    if (home === undefined) problems.push(`${at}: ${r.prefix} is not a prefix in 00-overview §8.3`);
    else if (home !== r.doc) problems.push(`${at}: ${r.id} belongs in ${home}.md`);
    const key = `${r.doc}\n${r.section}\n${r.prefix}`;
    const last = lastInSection.get(key);
    if (last !== undefined && r.number <= last) {
      const previous = `${r.prefix}-${String(last).padStart(3, '0')}`;
      problems.push(`${at}: ${r.id} comes after ${previous}; IDs increase within a section`);
    }
    lastInSection.set(key, Math.max(r.number, last ?? 0));
  }
  return problems;
}

function checkCitedIds(docs: Docs): string[] {
  const problems: string[] = [];
  const defined = definitions(docs);
  const prefixes = [...docs.prefixes.keys()].sort((a, b) => b.length - a.length);
  const cited = new RegExp(`\\b(?:${prefixes.join('|')})-\\d{3}\\b`, 'g');
  for (const md of prefixes.length > 0 ? docs.markdown : []) {
    for (const m of md.text.matchAll(cited)) {
      if (defined.has(m[0])) continue;
      problems.push(`${md.file}:${lineOf(md.text, m.index)}: cites ${m[0]}, which is not defined`);
    }
  }
  for (const c of docs.citations) {
    const what = c.kind === 'test' ? 'test name' : 'Implements comment';
    const r = defined.get(c.id);
    if (!r) problems.push(`${c.file}:${c.line}: ${what} cites ${c.id}, which is not defined`);
    else if (r.retired)
      problems.push(`${c.file}:${c.line}: ${what} cites ${c.id}, which is retired`);
  }
  return problems;
}

/** ADR citations, links, `spec/` paths, and section references in one markdown file. */
function checkReferences(docs: Docs, md: MarkdownFile): string[] {
  const problems: string[] = [];
  for (const m of md.text.matchAll(/\bADR-(\d{3})\b/g)) {
    if (docs.adrs.has(group(m, 1))) continue;
    problems.push(`${md.file}:${lineOf(md.text, m.index)}: ADR-${group(m, 1)} has no record`);
  }
  // Fences are blanked line by line, so a line number in `prose` is the same in the file.
  const prose = withoutFences(md.text);
  const at = (index: number) => `${md.file}:${lineOf(prose, index)}`;
  const noCode = prose.replace(/`[^`\n]*`/g, (span) => ' '.repeat(span.length));
  for (const m of noCode.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const problem = linkProblem(md.path, group(m, 1));
    if (problem) problems.push(`${at(m.index)}: ${problem}`);
  }
  for (const m of prose.matchAll(/`(spec\/[^`\s]*)`/g)) {
    const path = group(m, 1);
    if (/[*<>…]/.test(path) || existsSync(join(docs.specDir, path.slice('spec/'.length)))) continue;
    problems.push(`${at(m.index)}: \`${path}\` does not exist`);
  }
  for (const ref of sectionReferences(docs, prose))
    problems.push(`${at(ref.index)}: ${ref.message}`);
  return problems;
}

function linkProblem(from: string, target: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:|^#/.test(target)) return undefined;
  let path: string;
  try {
    path = decodeURI(target.split('#')[0] ?? '');
  } catch {
    return `link to ${target} is not a valid URL path`;
  }
  return existsSync(resolve(dirname(from), path))
    ? undefined
    : `link to ${target} does not resolve`;
}

/** `07-rules.md §3`, and every section in a list after it: `§3, §4 (RUL-020), and §5.1`. */
function sectionReferences(docs: Docs, prose: string) {
  const item = '(?:§|section )\\d+(?:\\.\\d+)?(?:\\s*\\([^)\\n]*\\))?';
  const pattern = new RegExp(
    `\\b(\\d\\d)-[a-z-]+(?:\\.md)?\`? (${item}(?:,?\\s*(?:and\\s+)?${item})*)`,
    'g',
  );
  return [...prose.matchAll(pattern)].flatMap((m) => {
    const sections = docs.sectionNumbers.get(group(m, 1));
    if (!sections) return [];
    return [...group(m, 2).matchAll(/(?:§|section )(\d+(?:\.\d+)?)/g)]
      .filter((s) => !sections.has(group(s, 1)))
      .map((s) => ({ index: m.index, message: `${group(m, 1)}-… has no §${group(s, 1)}` }));
  });
}

function checkTasks(docs: Docs): string[] {
  const byId = new Map(docs.tasks.map((t) => [t.id, t]));
  const defined = definitions(docs);
  return docs.tasks.flatMap((task) => {
    const problems: string[] = [];
    const plan = docs.phasePlans.get(task.phase);
    if (!plan?.includes(`](../tasks/${basename(task.file)})`)) {
      problems.push(`${task.file}: not listed in spec/phases/phase-${task.phase}.md`);
    }
    if (!STATUSES.includes(task.status)) {
      problems.push(`${task.file}: Status is "${task.status}"; use ${STATUSES.join(' or ')}`);
    }
    for (const dep of task.dependsOn) {
      if (!byId.has(dep)) problems.push(`${task.file}: depends on ${dep}, which does not exist`);
    }
    if (task.status === 'Done') return [...problems, ...checkDoneTask(docs, task, byId)];
    for (const id of task.requirements) {
      if (defined.get(id)?.retired) problems.push(`${task.file}: lists ${id}, which is retired`);
    }
    return problems;
  });
}

function checkDoneTask(docs: Docs, task: Task, byId: Map<string, Task>): string[] {
  const problems: string[] = [];
  for (const dep of task.dependsOn) {
    const status = byId.get(dep)?.status;
    if (status !== undefined && status !== 'Done')
      problems.push(`${task.file}: is Done, but ${dep} is not`);
  }
  if (task.notesTemplate) {
    problems.push(`${task.file}: is Done, but its completion notes still hold the template line`);
  }
  for (const part of NOTES_PARTS) {
    if (!task.notes.get(part)) {
      problems.push(`${task.file}: is Done, but its completion notes have no ${part} entry`);
    }
  }
  const defined = definitions(docs);
  const tested = testedIds(docs);
  for (const id of task.requirements) {
    const r = defined.get(id);
    if (!r || r.retired || STRUCTURAL_PREFIXES.has(r.prefix)) continue;
    if (tested.has(id) || task.notTested.includes(id)) continue;
    problems.push(
      `${task.file}: is Done, but no test name cites ${id} and Not tested has no ${id}: entry`,
    );
  }
  return problems;
}
