# P1-T03: Port core: compare, calendar, theme

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] TIME-001: all 518 truth-table rows round-trip and match weekdays.
- [ ] TIME-002, TIME-003: the long-count calendar's festivals and weekday skipping behave as `spec/12-time-world.md` §2.2 describes.
- [ ] UI-130: every theme in `content-library/themes/` passes `themeIssues`; contrast unit tests cover a pass and a fail.
- [ ] No `localeCompare` anywhere in `packages/core`.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
