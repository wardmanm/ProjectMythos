# P1-T08: Server content module: packs and libraries

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
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

- **Done:**
  - `apps/server/src/modules/content/`: `index.ts`, `types.ts`, `sources.ts`, `read.ts`,
    `parse.ts`, `validate.ts`, `validate-files.ts`, `validate-references.ts`,
    `validate-invariants.ts`, `validate-items.ts`, `resolve.ts`, `convert.ts`,
    `summaries.ts`, `load.ts`, `test-pack.ts`, and `README.md`, with 94 tests in 12 files.
    The module imports no other module.
  - `createContent({ sources, logger })` gives `listPacks()`, `loadPack(packId)`, and
    `listThemes()`, with no cache. `defaultSources(dataDir)` gives the folders. P1-T20
    builds it with the config store's `dataDir` and the server's logger.
  - Acceptance, by test:
    - the reference pack: `SCH-010: the reference pack offers Arrival with Wren, Coastal
      Mystery and four more tone profiles, and four rulesets`, with no issues;
    - SCH-100, SCH-101: `eight breaks are each reported with file, path, and message`, on a
      copy in `os.tmpdir()`, and the pass-order test beside it;
    - SCH-010: `a pack ruleset.standard wins, and a warning is logged`; SCH-011: `two files
      with one ID in one source are an issue`, for a pack and for a library;
    - SCH-103: `loading twice gives deep-equal results`.
  - `pnpm check` passes. The workspace has `Tests  294 passed (294)` and `spec/reference`
    `Tests  271 passed (271)`, and it ends with `Docs check passed: 834 requirements, 25
    tasks (6 done), 19 ADRs, 76 markdown files, 408 citations in code.`
- **Rulings:**
  - **Mike's decisions of 2026-11-05** (`P1-T08: spec: owner: content loading decisions`),
    each a row in 04-content-schemas' Decisions:
    - SCH-001: the loader checks the keys inside `media`, `voice`, `startingLocation`,
      `container`, and `bonuses` itself, and reports each unknown key at its path;
    - SCH-100: a pack reports only problems in library definitions it uses; a broken
      library definition is offered to no pack, and is logged;
    - SCH-101: a library file is reported as `content-library/…` or `library/…`;
    - §2: a data-directory pack replaces a repository pack with the same ID, with a
      warning.
  - **Mike's decision, SCH-090** (`P1-T08: spec: owner: a claim's aboutRef names an
    earlier entry`), from the conflict P1-T05 found with SCH-117. SCH-090 is amended in
    place; the loader and the reference checker report an `aboutRef` that names a later
    entry, apart from one that names no entry. A Decisions row records it.
  - **Spec fixes** (`P1-T08: spec: the repository's packs, and SCH-092 at load time`):
    - 04-content-schemas §2: the Pack row also names the repository's `content-packs/`;
    - SCH-092: at load time, relationships are checked against the setting's default
      ruleset (SCH-114); dropping and clamping stay at campaign creation.
  - **Reference bugs, SCH-100, SCH-011, SCH-010** (`P1-T08: spec: reference checker reports
    every issue`). The requirements win (OVR-031), so `check-fixtures.ts` and the port are
    fixed alike: item and relationship references were skipped without the default ruleset
    or slot schema; `loadAll` kept the last of two files with one ID; and the merge gave no
    shadow warning.
  - **Checks the reference lacks**: starting statuses (CON-020, and CON-024's fatal level
    and tags) and bonus tags (CON-024), so a pack cannot load and then fail P1-T17's strict
    fold.
  - **Rulings recorded in 04-content-schemas' Decisions**: `core`'s checks report path `''`;
    a library file that failed to parse still shadows by its file name; a library tone
    profile must name usable library definitions; `listThemes` order; pack folders whose
    names are not pack IDs are skipped with a warning; starting statuses and bonuses are
    checked at load; SCH-092 as above. Traps and Open are there too.
  - **Extra files** (CONV-132, CONV-014): `types.ts`, `parse.ts`, `validate-files.ts`,
    `validate-references.ts`, `validate-invariants.ts`, `validate-items.ts`, `load.ts`, and
    `test-pack.ts`, so no file passes 300 lines. `parse.ts` was not in the plan: it parses
    one JSON file, which pass 1 and the theme list share.
  - **Changes from the plan:**
    - `validatePack(pack, libraries)` takes `checkLibraries(user, builtIn)`'s result, so
      `listPacks` checks and logs the libraries once rather than once per pack;
    - SCH-011's per-source index is built in `validate-files.ts` as each folder is parsed;
      `resolve.ts` merges the sources;
    - a tone profile's or ruleset's `templatesDir`, and `templates.pack`, are null when the
      folder does not exist. `templates.engine` is always the path, since
      `content-library/templates/` arrives with P1-T18;
    - a container cycle is reported at `startingLocation.containerId`. An item in a missing
      container is reported once, as a reference, where the reference reported it twice.
  - **Other calls:**
    - a newer `schemaVersion` is the file's only issue, since its other fields may follow
      another format; a missing one gets its own message;
    - an unknown key is one issue per key, at the key's path, where Zod gives one issue
      for all of them at the object;
    - dot-files and dot-folders are skipped when reading;
    - the reference's GEAR-065 name check and place-cycle check are ported;
    - issues within a pass are sorted by file with `cmp`, keeping each file's own order.
- **Pending decisions:**
  - **Which slot schema are starting items checked against (SCH-082)?** SCH-082 says "the
    campaign's resolved slot schema", which a pack does not have when it loads. Does not
    block. Options:
    - (a) the setting's `slotSchemaId`, as the reference does. Implemented, as the choice
      that refuses fewest packs. A campaign using an override is still checked when it is
      created;
    - (b) the setting's default tone profile's `slotSchemaId` when it has one, matching a
      campaign created with the defaults;
    - (c) both, when they differ.
- **Not tested:** None. Every listed behavioral requirement has a test named by its ID.
- **Dependencies:** None.
