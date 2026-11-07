import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDocs } from './read';
import { countByDocument } from './report';
import { checkDocs, readyTasks } from './rules';

const OVERVIEW = `# Overview

## 8. How to read the spec

| Prefix | Document |
|---|---|
| OVR | 00-overview |
| ARCH | 01-architecture |
| RUL | 07-rules |

- **OVR-001** The spec is the source of truth (ADR-001).
`;

const ARCHITECTURE = `# Architecture

## 1. Layout

- **ARCH-001** The repository uses pnpm workspaces.
`;

const RULES = `# Rules

## 1. Dice

- **RUL-001** Roll the pool.
- **RUL-002** Two sixes are a critical.
- **RUL-003** (retired, P1-T01) Folded into RUL-002.

## 2. Effect

- **RUL-004** Effect is limited, standard, or great. See \`07-rules.md\` §1.
`;

const PLAN = `# Phase 1

| Task | Title | Depends on |
|---|---|---|
| [P1-T01](../tasks/P1-T01-dice.md) | Dice | — |
| [P1-T02](../tasks/P1-T02-effect.md) | Effect | T01 |
`;

const NOTES_TEMPLATE = `_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
`;

/** Completion notes as a done task has them, with the given Not tested part. */
const writtenNotes = (notTested: string) => `- **Done:** Built it. \`pnpm check\`: passed.
- **Rulings:** None.
- **Pending decisions:** None.
- **Not tested:** ${notTested}
- **Dependencies:** None.
`;

type TaskOptions = { status?: string; deps?: string; reqs: string; notes?: string };

function task(id: string, opts: TaskOptions) {
  return `# ${id}: A task

| | |
|---|---|
| **Phase** | 1 |
| **Status** | ${opts.status ?? 'Not started'} |
| **Depends on** | ${opts.deps ?? '—'} |

## Requirements

Implement every ID below. OVR and CONV
requirements are met by \`pnpm check\` (OVR-001).

${opts.reqs}

## Completion notes

${opts.notes ?? NOTES_TEMPLATE}`;
}

/** A small repository: spec/ plus whatever files the test adds or replaces. */
function repo(files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mythos-docs-'));
  const all: Record<string, string> = {
    'spec/00-overview.md': OVERVIEW,
    'spec/01-architecture.md': ARCHITECTURE,
    'spec/07-rules.md': RULES,
    'spec/decisions/ADR-001-sources.md': '# ADR-001: Sources\n',
    'spec/phases/phase-1.md': PLAN,
    'spec/tasks/P1-T01-dice.md': task('P1-T01', { reqs: 'RUL-001, RUL-002' }),
    'spec/tasks/P1-T02-effect.md': task('P1-T02', { deps: 'P1-T01', reqs: 'RUL-004' }),
    'CLAUDE.md': 'Read [the overview](spec/00-overview.md) and `spec/07-rules.md`.\n',
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return readDocs(join(root, 'spec'), root);
}

const problemsIn = (files: Record<string, string> = {}) => checkDocs(repo(files));

describe('OVR-038: requirement definitions and citations', () => {
  it('OVR-038: passes a consistent spec', () => {
    expect(problemsIn()).toEqual([]);
  });

  it('OVR-038: reports an ID defined twice, in the wrong document, or out of order', () => {
    const more =
      '\n## 3. More\n\n- **RUL-006** Later.\n- **RUL-005** Earlier.\n- **RUL-002** Again.\n- **OVR-002** Misplaced.\n';
    expect(problemsIn({ 'spec/07-rules.md': `${RULES}${more}` })).toEqual([
      'spec/07-rules.md:16: RUL-005 comes after RUL-006; IDs increase within a section',
      'spec/07-rules.md:17: RUL-002 is already defined at spec/07-rules.md:6',
      'spec/07-rules.md:17: RUL-002 comes after RUL-006; IDs increase within a section',
      'spec/07-rules.md:18: OVR-002 belongs in 00-overview.md',
    ]);
  });

  it('OVR-038: reads bold IDs in the closing sections as citations, not definitions', () => {
    const closing =
      '\n## Traps\n\n- **RUL-002** is easy to misread.\n\n## Open\n\n- **RUL-009** later.\n';
    expect(problemsIn({ 'spec/07-rules.md': `${RULES}${closing}` })).toEqual([
      'spec/07-rules.md:19: cites RUL-009, which is not defined',
    ]);
  });

  it('OVR-038: reports undefined and retired IDs cited by documents, test names, and code', () => {
    const problems = problemsIn({
      'spec/07-rules.md': `${RULES}\nSee RUL-099.\n`,
      'packages/core/src/dice.ts': '// Implements RUL-001 and RUL-003.\nexport const x = 1;\n',
      'packages/core/src/dice.test.ts':
        "it.skipIf(slow)('RUL-002, and RUL-098: a critical', () => {});\n",
      'apps/client/e2e/play.spec.ts': "test.describe('RUL-097: play', () => {});\n",
    });
    expect(problems).toEqual([
      'spec/07-rules.md:13: cites RUL-099, which is not defined',
      'apps/client/e2e/play.spec.ts:1: test name cites RUL-097, which is not defined',
      'packages/core/src/dice.test.ts:1: test name cites RUL-098, which is not defined',
      'packages/core/src/dice.ts:1: Implements comment cites RUL-003, which is retired',
    ]);
  });
});

describe('OVR-038: references', () => {
  it('OVR-038: reports missing ADRs, broken links, missing spec paths, and missing sections', () => {
    const claude = [
      'See ADR-002, [rules](spec/07-rules.md), [gone](spec/gone.md), `spec/nope.md`.',
      'Read `07-rules.md` §1, §2 (RUL-004), and §9, and [bad](a%zz.md).',
      '',
      '```',
      '[ignored](in/a/fence.md) `spec/also-ignored.md` 07-rules.md §8',
      '```',
      '',
    ].join('\n');
    expect(problemsIn({ 'CLAUDE.md': claude })).toEqual([
      'CLAUDE.md:1: ADR-002 has no record',
      'CLAUDE.md:1: link to spec/gone.md does not resolve',
      'CLAUDE.md:2: link to a%zz.md is not a valid URL path',
      'CLAUDE.md:1: `spec/nope.md` does not exist',
      'CLAUDE.md:2: 07-… has no §9',
    ]);
  });
});

describe('OVR-038: phase plans', () => {
  const signOff = [
    '',
    '| Check | macOS | Windows |',
    '|---|---|---|',
    '| S1. Roll the dice | pass, abc1234 | |',
    '| S2. Read the effect | fail: no effect shown (#30, P1) | |',
    '',
    '**Found while testing**',
    '',
    '- #31 Bug, P2, while on S1 (macOS): Dice tray | flickers on a phone',
    '- #32 Feat, P1, after the last check (macOS): Roll from the keyboard',
    '',
  ].join('\n');

  it('OVR-038: passes a plan with a Found while testing list below its Sign-off table', () => {
    const docs = repo({ 'spec/phases/phase-1.md': `${PLAN}${signOff}` });
    expect(checkDocs(docs)).toEqual([]);
    expect(readyTasks(docs).map((t) => t.id)).toEqual(['P1-T01']);
  });

  it('OVR-038: reports an undefined ID in a Found while testing line', () => {
    const line = '- #33 Change, P1, while on S2 (macOS): RUL-099 should round up\n';
    expect(problemsIn({ 'spec/phases/phase-1.md': `${PLAN}${signOff}${line}` })).toEqual([
      'spec/phases/phase-1.md:17: cites RUL-099, which is not defined',
    ]);
  });
});

describe('OVR-038: tasks', () => {
  it('OVR-038: reports a task missing from its plan, a bad Status, an unknown dependency, or a retired requirement', () => {
    const extra = task('P1-T03', { status: 'Started', deps: 'P1-T09', reqs: 'RUL-003' });
    expect(problemsIn({ 'spec/tasks/P1-T03-extra.md': extra })).toEqual([
      'spec/tasks/P1-T03-extra.md: not listed in spec/phases/phase-1.md',
      'spec/tasks/P1-T03-extra.md: Status is "Started"; use Not started or Done',
      'spec/tasks/P1-T03-extra.md: depends on P1-T09, which does not exist',
      'spec/tasks/P1-T03-extra.md: lists RUL-003, which is retired',
    ]);
  });

  it('OVR-038: holds a done task to its dependencies, its notes, and its tests', () => {
    const done = task('P1-T02', { status: 'Done', deps: 'P1-T01', reqs: 'OVR-001, RUL-004' });
    expect(problemsIn({ 'spec/tasks/P1-T02-effect.md': done })).toEqual([
      'spec/tasks/P1-T02-effect.md: is Done, but P1-T01 is not',
      'spec/tasks/P1-T02-effect.md: is Done, but its completion notes still hold the template line',
      'spec/tasks/P1-T02-effect.md: is Done, but its completion notes have no Done entry',
      'spec/tasks/P1-T02-effect.md: is Done, but its completion notes have no Rulings entry',
      'spec/tasks/P1-T02-effect.md: is Done, but its completion notes have no Pending decisions entry',
      'spec/tasks/P1-T02-effect.md: is Done, but its completion notes have no Not tested entry',
      'spec/tasks/P1-T02-effect.md: is Done, but its completion notes have no Dependencies entry',
      'spec/tasks/P1-T02-effect.md: is Done, but no test name cites RUL-004 and Not tested has no RUL-004: entry',
    ]);
  });

  it('OVR-038: reads a wrapped requirements list, and needs ARCH requirements tested', () => {
    const done = task('P1-T01', {
      status: 'Done',
      reqs: 'ARCH-001, RUL-001,\nRUL-002',
      notes: writtenNotes('RUL-001: checked by hand, like RUL-002.'),
    });
    expect(problemsIn({ 'spec/tasks/P1-T01-dice.md': done })).toEqual([
      'spec/tasks/P1-T01-dice.md: is Done, but no test name cites ARCH-001 and Not tested has no ARCH-001: entry',
      'spec/tasks/P1-T01-dice.md: is Done, but no test name cites RUL-002 and Not tested has no RUL-002: entry',
    ]);
  });

  it('OVR-038: accepts a done task whose requirements are tested or have a Not tested entry', () => {
    const done = task('P1-T01', {
      status: 'Done',
      reqs: 'RUL-001, RUL-002',
      notes: writtenNotes('\n  - RUL-001: a manual\n    check in the owner checklist.'),
    });
    const problems = problemsIn({
      'spec/tasks/P1-T01-dice.md': done,
      'packages/core/src/dice.test.ts': "describe('RUL-002: criticals', () => {});\n",
    });
    expect(problems).toEqual([]);
  });

  it('OVR-038: expands a dependency range', () => {
    const done = task('P1-T02', {
      status: 'Done',
      deps: 'P1-T01 to P1-T01',
      reqs: 'RUL-004',
      notes: writtenNotes('RUL-004: prose only.'),
    });
    expect(problemsIn({ 'spec/tasks/P1-T02-effect.md': done })).toEqual([
      'spec/tasks/P1-T02-effect.md: is Done, but P1-T01 is not',
    ]);
  });
});

describe('OVR-037: the trace report', () => {
  it('OVR-037: counts requirements per document from task status and test names', () => {
    const docs = repo({
      'spec/tasks/P1-T01-dice.md': task('P1-T01', {
        status: 'Done',
        reqs: 'RUL-001, RUL-002',
        notes: writtenNotes('RUL-001: checked by hand.'),
      }),
      'packages/core/src/dice.test.ts': "it('RUL-002: a critical', () => {});\n",
      'packages/core/src/dice.ts': '// Implements RUL-002.\n',
    });
    const zero = { retired: 0, inTasks: 0, done: 0, tested: 0, excused: 0, inCode: 0 };
    expect(countByDocument(docs)).toEqual([
      { doc: '00-overview', defined: 1, ...zero },
      { doc: '01-architecture', defined: 1, ...zero },
      {
        doc: '07-rules',
        defined: 4,
        retired: 1,
        inTasks: 3,
        done: 2,
        tested: 1,
        excused: 1,
        inCode: 1,
      },
    ]);
    expect(readyTasks(docs).map((t) => t.id)).toEqual(['P1-T02']);
  });
});
