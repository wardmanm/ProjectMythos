/*
 * The trace report behind `pnpm trace` (OVR-037): what is built, derived from task
 * status and test names rather than written by hand.
 */
import type { Docs } from './read';
import { definitions, readyTasks, testedIds } from './rules';

/** Requirement counts for one spec document. */
export type DocumentCounts = {
  doc: string;
  defined: number;
  retired: number;
  inTasks: number;
  done: number;
  tested: number;
  excused: number;
  inCode: number;
};

const COLUMNS = ['defined', 'retired', 'in tasks', 'done', 'tested', 'not tested', 'in code'];

/** Counts per document, in document order, skipping documents with no requirements. */
export function countByDocument(docs: Docs): DocumentCounts[] {
  const doneTasks = docs.tasks.filter((t) => t.status === 'Done');
  const inTasks = new Set(docs.tasks.flatMap((t) => t.requirements));
  const done = new Set(doneTasks.flatMap((t) => t.requirements));
  const excused = new Set(doneTasks.flatMap((t) => t.notTested));
  const tested = testedIds(docs);
  const inCode = new Set(docs.citations.filter((c) => c.kind === 'code').map((c) => c.id));
  const rows = new Map<string, DocumentCounts>();
  for (const r of definitions(docs).values()) {
    const row = rows.get(r.doc) ?? {
      doc: r.doc,
      defined: 0,
      retired: 0,
      inTasks: 0,
      done: 0,
      tested: 0,
      excused: 0,
      inCode: 0,
    };
    row.defined += 1;
    if (r.retired) row.retired += 1;
    if (inTasks.has(r.id)) row.inTasks += 1;
    if (done.has(r.id)) row.done += 1;
    if (tested.has(r.id)) row.tested += 1;
    if (excused.has(r.id)) row.excused += 1;
    if (inCode.has(r.id)) row.inCode += 1;
    rows.set(r.doc, row);
  }
  return [...rows.values()];
}

/** The report as printed by `pnpm trace`. */
export function formatReport(docs: Docs): string {
  const done = docs.tasks.filter((t) => t.status === 'Done').length;
  const width = Math.max(...docs.tasks.map((t) => t.status.length), 'Not started'.length);
  const tasks = docs.tasks.map((t) => `  ${t.id}  ${t.status.padEnd(width)}  ${t.title}`);
  const rows = countByDocument(docs);
  const total: DocumentCounts = {
    doc: 'total',
    defined: sum(rows, 'defined'),
    retired: sum(rows, 'retired'),
    inTasks: sum(rows, 'inTasks'),
    done: sum(rows, 'done'),
    tested: sum(rows, 'tested'),
    excused: sum(rows, 'excused'),
    inCode: sum(rows, 'inCode'),
  };
  const docWidth = Math.max(...rows.map((r) => r.doc.length), 'Requirements'.length);
  const header = `${'Requirements'.padEnd(docWidth + 2)}${COLUMNS.map((c) => c.padStart(12)).join('')}`;
  const lines = [...rows, total].map((r) => `  ${r.doc.padEnd(docWidth)}${cells(r)}`);
  return [
    'Tasks',
    ...tasks,
    `  ${done} of ${docs.tasks.length} done`,
    `  Ready to start: ${
      readyTasks(docs)
        .map((t) => t.id)
        .join(', ') || 'none'
    }`,
    '',
    header,
    ...lines,
    '',
    'done: listed by a done task · tested: cited by a test name · not tested: named under a',
    "done task's Not tested · in code: cited by an Implements comment",
  ].join('\n');
}

function cells(r: DocumentCounts): string {
  const values = [r.defined, r.retired, r.inTasks, r.done, r.tested, r.excused, r.inCode];
  return values.map((v) => String(v).padStart(12)).join('');
}

type CountKey = Exclude<keyof DocumentCounts, 'doc'>;

function sum(rows: DocumentCounts[], key: CountKey): number {
  return rows.reduce((total, row) => total + row[key], 0);
}
