# P1-T03: Port core: compare, calendar, theme

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T02 |
| **Branch** | `p1-t03-core-foundations` |

## Goal

Port the first three pure modules from the reference code into `packages/core`,
meeting the conventions, with tests named by requirement.

## Read

- `spec/reference/README.md` (porting rules)
- `spec/02-conventions.md` §2, §4, §8, §13; CONV-087
- `spec/12-time-world.md` §2 (TIME-001 to TIME-012)
- `spec/14-ui.md` §3.1, §3.2 (UI-031), §16 (UI-130)
- `spec/reference/core/compare.ts`, `calendar.ts`, `calendar.test.ts`, `theme.ts`, `theme.test.ts`

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

CONV-087, TIME-001, TIME-002, TIME-003, TIME-004, TIME-010, TIME-011, TIME-012, UI-031, UI-130

## Outputs

- `packages/core/src/compare.ts`, `calendar.ts`, `theme.ts`, each with a `.test.ts`
- `packages/core/src/index.ts` exporting their public functions
- `packages/core/README.md`
- `packages/core/package.json`: dependency `@mythos/contracts` (`workspace:*`)

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`

## Design notes

- Reformat to Prettier, add a JSDoc line to every export (CONV-022), and cite the
  requirement each function implements (CONV-021).
- Tests use `it`/`expect` with names starting with the requirement ID. Tests may read
  files: the Gregorian truth table is `spec/fixtures/test/calendars/gregorian-truth.json`,
  the invented calendar `spec/fixtures/test/calendars/calendar.long-count.json`, and the
  Gregorian calendar and themes come from `content-library/`. Resolve paths from the
  test file's location with `node:path` and `node:url`.
- Keep behavior identical to the reference: its tests are the minimum. Where reference
  behavior contradicts a requirement, the requirement wins (OVR-031); handle the
  disagreement under CONV-133.

## Acceptance

- [x] TIME-001: all 518 truth-table rows round-trip and match weekdays.
- [x] TIME-002, TIME-003: the long-count calendar's festivals and weekday skipping behave as `spec/12-time-world.md` §2.2 describes.
- [x] UI-130: every theme in `content-library/themes/` passes `themeIssues`; contrast unit tests cover a pass and a fail.
- [x] No `localeCompare` anywhere in `packages/core`.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `packages/core/src/`: `compare.ts`, `calendar.ts`, `calendar-display.ts`, and
    `theme.ts`, each with its tests (36 in all), exported from `index.ts`. The README
    lists the API.
  - Acceptance, by test:
    - TIME-001: `all 518 truth-table dates and weekdays match, in both directions`;
    - TIME-002 and TIME-003: the Long Count's Leapnight, festival weekdays, and four
      unbroken years of weeks;
    - UI-130: one test per theme in `content-library/themes/` (six), plus the careless
      edit and a contrast pass and fail.
  - No call to `localeCompare` in `packages/core`: `git grep "localeCompare("` finds
    none, and lint bans it. The word appears only in two comments that say not to use it.
  - Verified, then reverted:
    - `cmp` written as plain `<` fails the astral-character test;
    - the new lint test shows `process`, `fetch`, and `setTimeout` reported in core
      source and allowed in core tests and the server.
  - `pnpm check` passes. The workspace has `Tests  96 passed (96)` and `spec/reference`
    `Tests  267 passed (267)`, and it ends with `Docs check passed: 834 requirements, 25
    tasks (4 done), 19 ADRs, 75 markdown files, 116 citations in code.`
- **Rulings:**
  - **CONV-087, spec fix** (`P1-T03: spec: the reference cmp compares code points`). The
    reference `cmp` used `<`, which compares UTF-16 code units and puts characters
    beyond U+FFFF before U+E000 to U+FFFF. CONV-087, ADR-011, and SQLite's `BINARY`
    collation all use code-point order, so the requirement wins (OVR-031). Both the
    reference and the port now walk the strings with `codePointAt`. 02-conventions gains
    a Trap.
  - **CONV-060: Node's types in `core`, with lint holding the line.** The tests read
    fixtures with `node:fs`, so `packages/core` gains `@types/node` and
    `types: ["node"]`. `eslint.config.js` bans `process`, `Buffer`, `fetch`, `global`,
    `require`, and the timers in core source, and `scripts/lint-rules.test.ts` has a
    test for it. These are extra files (CONV-132). Recorded in 02-conventions'
    Decisions.
  - **`calendar-display.ts` is an extra file** (CONV-132, CONV-014). After Prettier,
    `calendar.ts` came to 334 lines, so `formatDate` and `formatDuration` (12-time-world
    §2.1, Display) moved out, with their tests.
  - **`minutesUntil` is ported and tested as TIME-021**, though the task does not list
    TIME-021: it is in the reference file, and the port keeps its behavior.
  - **Dropped reference test:** "tone profile references a theme" tests
    `ToneProfileSchema`, not core (porting rule 3).
  - **Tests beyond the reference**, for CONV-112's branch coverage:
    - dates before the epoch, and a calendar with no leap rule or no weekdays;
    - out-of-range months, hours, and minutes;
    - every `calendarIssues` branch, an unknown format token, adjacent duration units,
      and a theme with no palette.
- **Pending decisions:** None.
- **Not tested:** None. Every listed behavioral requirement has a test named by its ID.
- **Dependencies:**
  - `@types/node` 26.6.4 as a dev dependency of `packages/core`, on CONV-091's list.
