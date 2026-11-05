# content

Content packs and libraries. It finds packs in their folders, reads them and both libraries
into memory, validates them with pure functions, and resolves a pack for campaign creation.
It imports no other module (ARCH-021). Content files are only ever read (SCH-004).

## Public API (`index.ts`)

- `defaultSources(dataDir)` gives the folders content comes from (04-content-schemas §2):
  - packs in the repository's `content-packs/`, then in `<dataDir>/content-packs/`; a
    data-directory pack replaces a repository pack with the same ID;
  - the user library, `<dataDir>/library/`, which may be missing;
  - the built-in library, the repository's `content-library/`, which must exist;
  - the engine's templates, `content-library/templates/`.

  Repository folders are found from the module's own location, never the working folder.

- `createContent({ sources, logger })` returns a `Content`, built once by the composition
  root (ARCH-022). There is no cache: every call reads the files again.
  - `listPacks()` gives every pack's `PackSummary`, sorted by ID, with its issues (SCH-102).
    A broken pack is listed with whatever parsed.
  - `loadPack(packId)` gives a `LoadedPack`, or `not_found`, or `validation_failed` whose
    `details.issues` lists every `PackIssue`. A pack with any issue is refused.
  - `listThemes()` gives every theme that passes `themeIssues` (UI-031): the built-in
    library's, then the user library's, then each pack's by pack ID. The first theme with an
    ID wins.
- `LoadedPack` holds what campaign creation (P1-T17) snapshots: the manifest and setting;
  the calendar and slot schemas; the tone profiles, rulesets, and themes the pack offers,
  each with its source and templates folder; scenarios with their openings; runtime
  entities sorted by ID, with canon; starting statuses in authored form; history and
  relationships in file order; and the pack's and engine's templates folders (SCH-023).
- `ContentLogger` is `{ warn(fields, message) }`, which pino's logger fits. The module warns
  when a pack definition shadows a library one, when a user-library definition shadows a
  built-in one (SCH-010), when two pack folders hold one pack ID, when a pack folder's name
  is not a pack ID, and for each broken library definition.

## How loading works

1. `read.ts` reads every `.json` and `.md` file as text: LF line endings, no BOM, paths with
   forward slashes, in `cmp` order. `templates/` folders are noted but not read, and `media/`
   and `fonts/` are skipped.
2. `validate.ts` checks the libraries once (`checkLibraries`), then each pack
   (`validatePack`) in three passes (SCH-100), each reporting every issue it finds:
   - `validate-files.ts`, files: JSON, `schemaVersion`, the strict schema, IDs, kinds, and
     canon. `parse.ts` parses one file;
   - `validate-references.ts`, references: definitions through the lookup order, and
     entities of the right kind;
   - `validate-invariants.ts` and `validate-items.ts`, invariants: `core`'s calendar,
     ruleset, and theme checks, dates, stats, statuses, items placed as moves, history, and
     relationships, against the setting's calendar, slot schema, and default ruleset.
3. Issues come out in pass order, then file order. A check is skipped only when its input is
   missing or failed to parse, which is already an issue.
4. A pack reports only the library problems it uses, under the library file
   (`content-library/…` or `library/…`). A broken library definition is offered to no pack.
5. `resolve.ts` merges pack, user library, and built-in library (SCH-010); `convert.ts` turns
   authored entities into runtime ones (SCH-005); `summaries.ts` builds `PackSummary`.

`test-pack.ts` is test support: the reference pack in memory or copied to a temp folder.

## Governing spec

- [04-content-schemas.md](../../../../../spec/04-content-schemas.md) §1, §2, §4 to §8
  invariants, §10, and its Traps, Decisions, and Open sections.
- [03-contracts.md](../../../../../spec/03-contracts.md) §6 (runtime entities), §14
  (`PackSummary`, `PackIssue`).
- [14-ui.md](../../../../../spec/14-ui.md) §3.1 and UI-031 (themes).
- [07-rules.md](../../../../../spec/07-rules.md) RUL-002, and
  [12-time-world.md](../../../../../spec/12-time-world.md) TIME-004.
