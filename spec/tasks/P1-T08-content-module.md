# P1-T08: Server content module: packs and libraries

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T04, P1-T06 |
| **Branch** | `p1-t08-content-module` |

## Goal

Find, load, and validate packs and library definitions, reporting every problem
with its file and JSON path, and produce the `PackSummary` list for the library.

## Read

- `spec/04-content-schemas.md` §1, §2, §10, and the invariants under §4 to §8
- `spec/14-ui.md` §3.1 (the theme schema)
- `spec/03-contracts.md` §6 (runtime entities), §14 (`PackSummary`, `PackIssue`)
- `spec/reference/scripts/check-fixtures.ts` (a complete validator to learn from)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

SCH-001, SCH-002, SCH-003, SCH-004, SCH-005, SCH-010, SCH-011, SCH-012, SCH-020, SCH-021, SCH-022, SCH-023, SCH-062, SCH-070, SCH-071, SCH-072, SCH-080, SCH-081, SCH-082, SCH-083, SCH-090, SCH-091, SCH-092, SCH-100, SCH-101, SCH-102, SCH-103, RUL-002, TIME-004, UI-031

## Outputs

- `apps/server/src/modules/content/`: `index.ts`, `sources.ts` (where content lives), `read.ts` (reads files into memory), `validate.ts` (pure), `resolve.ts` (definition lookup order), `convert.ts` (authored to runtime, SCH-005), `summaries.ts`, tests, `README.md`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other server modules

## Design notes

- **Sources** (SCH §2): packs in the repository's `content-packs/` and in
  `<dataDir>/content-packs/`; the user library at `<dataDir>/library/`; the built-in
  library at the repository's `content-library/`. Locate repository folders relative to
  the server package with `import.meta.url`, never the working directory.
- **Pure apart from reading** (SCH-103): read every file of a pack and the libraries
  into memory first, then validate with pure functions over that data. The reference
  checker shows every check; reshape it into functions that return `PackIssue`s.
- Report all issues, never just the first (SCH-100), and include library problems
  (a ruleset with `rulesetIssues`, a theme with `themeIssues`, a calendar with
  `calendarIssues`) under the file they came from.
- A pack definition that shadows a library one logs a warning (SCH-010); two
  definitions with one ID in one source is an issue (SCH-011).
- Convert authored entities to runtime form as SCH-005 says: `voice` becomes
  `voiceProfile`, faction `goals` carry over, and `startingStatuses` stay in authored
  form for setup to turn into statuses (P1-T17), so no IDs are generated here.
- Expose: `listPacks(): PackSummary[]`, `loadPack(packId)` returning the resolved,
  validated content with runtime entities and canon text, `listThemes()`, and, for
  P1-T17 and P1-T18, the absolute paths of every `templates/` folder involved: the
  pack's, the tone profile's and ruleset's (SCH-023), and the engine's.

## Acceptance

- [ ] The reference pack loads with no issues, and its `PackSummary` lists *Arrival* with Wren as the premade PC, four tone profiles plus *Coastal Mystery*, and four rulesets.
- [ ] SCH-100, SCH-101: a broken copy of the reference pack in `os.tmpdir()`, with the eight breaks used to test `spec/reference/scripts/check-fixtures.ts` (a typo key, a missing place, an overfull pocket, an unknown slot, an over-budget PC, a dangling `aboutRef`, an unknown relationship dimension, an unknown theme), reports each with its file and path.
- [ ] SCH-010 and SCH-011 each have a test.
- [ ] SCH-103: loading twice gives deep-equal results.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
