# P1-T07: Server storage module

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T06 |
| **Branch** | `p1-t07-storage-module` |

## Goal

Own every campaign database: the `node:sqlite` wrapper, migrations, the first
schema, campaign folders, and the repositories for turns, sets, commits, branches,
campaign state, model call records, and jobs.

## Read

- `spec/01-architecture.md` §1 (ARCH-007), §3 (ARCH-022), §4 (all)
- `spec/02-conventions.md` §7, CONV-116
- `spec/06-turn-engine.md` §2, TRN-001 to TRN-003, TRN-011
- `spec/03-contracts.md` §8, §10.1, §11, §14.1 (`ModelCallRecordSchema`)
- `spec/05-providers.md` PRV-062
- `spec/13-content-settings.md` CSET-020
- `spec/09-context.md` CTX-005
- `spec/15-media.md` MED-010, MED-011
- `spec/decisions/ADR-003-hand-written-sql.md`, `ADR-012-node-sqlite.md`

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-031, ARCH-040, ARCH-041, ARCH-042, ARCH-050, ARCH-051, ARCH-061, ARCH-130, CON-084, CONV-050, CONV-051, CONV-052, CONV-053, CONV-054, CONV-055, CONV-116, CSET-020, CTX-005, PRV-062, TRN-001, TRN-002, TRN-003, TRN-011

## Outputs

- `apps/server/src/modules/storage/`: `index.ts`, `sqlite.ts`, `migrate.ts`, `migrations/0001-initial.sql`, `rows.ts`, `campaigns.ts`, and one repository file per area (`turns.ts`, `campaign-state.ts`, `canon.ts`, `model-calls.ts`, `jobs.ts`), tests, `README.md`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other server modules

## Design notes

- **Wrapper** (CONV-055): `openDatabase(path)` sets `journal_mode=WAL`,
  `foreign_keys=ON`, and a busy timeout, and returns an object with `exec`, `prepare`
  (`run`, `get`, `all`), `transaction(fn)` (`BEGIN IMMEDIATE`; nesting throws), and
  `close`. Only this file imports `node:sqlite`; add a lint rule or a test that says so.
- **Migration 0001** creates, as `STRICT` tables: `campaign` (one row: id, name, pack
  ID and version, setting ID, scenario ID, tone profile ID, ruleset ID, theme ID, PC
  ID, first scene ID, created and last-played times); `canon` (the content snapshot:
  kind, ID, JSON, Markdown, and template files by layer and path); `turns`;
  `commit_sets` (with `seq`, assigned here in creation order, CON-084, and `active`);
  `commits` (set ID, `seq`, type, JSON payload); `branches`; `branch_turns`;
  `campaign_state` (key, version, JSON value, created time; the current value is the
  highest version, so content settings and template overrides keep their history,
  CSET-020, CTX-005); `resolution_drafts`; `turn_suggestions`; `snapshots`;
  `replay_conflicts`; `bookmarks`; `model_calls` (the JSON record plus `turn_id` and
  `created_at` columns); `jobs` (ID, type, priority, device ID, turn ID, status,
  attempts, JSON payload, last error, created and updated times; PRV-062); and
  `assets` with `asset_versions` (reserved, ARCH-130). Later phases add their own
  migrations.
- **Public API.** At least: `openDatabase`; campaigns: `createCampaignFolder`,
  `openCampaign`, `listCampaigns`, `deleteCampaign`, `readCampaign`, `touchLastPlayed`;
  canon: `writeCanon`, `readCanon`, `readTemplates`; turns: `insertTurn`,
  `appendSet` (a set and its commits on an existing turn), `setTurnStatus`,
  `readTurn`, `readTurnsOnBranch(branchId, beforeDepth, limit)`, `readSetsForRead(point)`
  (every active set and commit a read point needs, each set with its turn's depth,
  sorted by depth and then set `seq`; core's `orderSets` applies TRN-061's order);
  branches:
  `createBranch`, `readBranch`, `listBranches`; state: `readState(key)`,
  `writeState(key, value)` (a new version), `readStateHistory(key)`; model calls:
  `insertModelCall`, `listModelCalls(turnId)`, `readModelCall(id)`,
  `pruneModelCalls(olderThan)`; jobs: `insertJob`, `updateJob`, `listUnfinishedJobs`.
  Later tasks that need more add it to this module in their own change and list the
  file in their outputs; new tables come only through new migrations (CONV-052).
- Every row read is parsed with a Zod row schema; JSON columns are parsed with the
  contract schema they hold (CONV-030).
- **Turns repository.** `insertTurn` writes the turn, its sets, and their commits,
  moves the branch head, and adds the `branch_turns` row, in one transaction
  (TRN-011, ARCH-041). Reads return sets by depth, then set `seq`, then commit `seq`;
  TRN-061's stage order is core's `orderSets`, which the caller applies. Only
  `turns.status` and `commit_sets.active` are ever updated (TRN-001).
- **Campaign folders.** `createCampaignFolder`, `openCampaign` (one cached connection
  per campaign), `listCampaigns`, `deleteCampaign` (close the connection before
  removing the folder: Windows will not delete an open file).
- **Retention** (ARCH-061): a function that deletes model call records older than
  `retention.modelCallRecordDays`, run when a campaign opens.
- **Rebuild** (ARCH-042): `rebuildProjections` rebuilds `branch_turns` and
  `commit_sets.active` from the log. P1-T20 adds the `rebuild-projections` command
  that runs it, once the composition root exists (ARCH-007, ARCH-022). Later phases
  extend it.

## Acceptance

- [x] ARCH-050: opening a database twice runs each migration once; a migration that fails rolls back.
- [x] ARCH-041: an error thrown inside `transaction` leaves no rows behind.
- [x] TRN-003, ARCH-042: after inserting a chain of turns, a rebuild produces the same `branch_turns` rows.
- [x] CONV-051: a row with a corrupt JSON column fails with a clear parse error, not a crash later.
- [ ] Deleting an open campaign works on Windows (CI).
- [x] Storage tests each use a fresh database in `os.tmpdir()` (CONV-116).
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/storage/`: `sqlite.ts`, `migrate.ts`,
    `migrations/0001-initial.sql`, `rows.ts`, `campaigns.ts`, `turns.ts`,
    `branches.ts`, `read-sets.ts`, `rebuild.ts`, `campaign-state.ts`, `canon.ts`,
    `model-calls.ts`, `jobs.ts`, `testing.ts`, `index.ts`, and `README.md`, with 61
    tests in 13 files. The module imports no other module; time, retention, and paths
    are parameters.
  - Acceptance, by test:
    - ARCH-050: `opening a database twice runs each migration once`, `a migration that
      fails rolls back, and so does its migrations row`, and `a database from a newer
      Mythos is refused with a clear message`;
    - ARCH-041: `an error thrown inside leaves no rows behind`, plus nesting, a failing
      statement, and an async `fn`;
    - TRN-003, ARCH-042: `rebuilding after a chain of turns reproduces branch_turns and
      active`, on a consistent database and on emptied projections;
    - CONV-051: `a commit with corrupt JSON fails at read time, naming the table and
      row`, and the same for canon and campaign state;
    - deleting an open campaign: `deleting an open campaign closes it and removes its
      folder` passes on macOS; CI runs it on `windows-latest` when the branch is pushed;
    - CONV-116: `source-rules.test.ts` checks that every storage test gets its folders
      from `createTestSpace()` (`mkdtempSync` in `os.tmpdir()`) and calls
      `space.cleanUp()`, which closes every database before removing its folder.
  - Vitest loads `node:sqlite` with no flag and no warning (checked before coding).
  - Verified, then reverted: without the supersession update, four tests fail;
    without the commits update trigger, the TRN-001 test fails; without
    `insertTurn`'s transaction, the TRN-011 rollback test fails.
  - `pnpm check` passes. The workspace has `Tests  261 passed (261)` and
    `spec/reference` `Tests  271 passed (271)`, and it ends with `Docs check passed: 834 requirements, 25
    tasks (6 done), 19 ADRs, 76 markdown files, 337 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, on the plan, 2026-11-05), each in its own
    `P1-T07: spec: owner:` commit and a Decisions row:
    - ARCH-040 is reworded: game state and its history change only through commits,
      and the exceptions are named. Beyond Mike's list (branches, `campaign_state`,
      model call records, jobs, assets), it also names what the spec already says is
      not a commit, so the documents agree: the rest of TRN-002's state (resolution
      drafts, bookmarks) and the caches (snapshots, ARCH-044; suggestions, TRN-059).
      The section's introduction names the content snapshot (ARCH-045). 01-architecture
      Decisions. `CLAUDE.md`'s Never line still paraphrases the old wording.
    - `sqlite.ts` imports `DatabaseSync`; ADR-012 is amended. 02-conventions Decisions.
    - Each public storage write is one transaction; `insertRootTurn` is the first
      dedicated multi-write function. 01-architecture Decisions.
    - TRN-001 triggers in 0001, with no migration hash check, and a Trap about adding
      columns (02-conventions, with the other migration traps). 06-turn-engine
      Decisions.
    - TRN-061's order belongs to core's `orderSets`; `readSetsForRead` sorts by depth
      and set `seq` only. This task's design notes say so. 06-turn-engine Decisions.
  - **ARCH-130, spec fix** (`P1-T07: spec: ARCH-130 …`): it called assets a projection;
    MED-010 makes them campaign-level state. It now reserves the `assets` and
    `asset_versions` tables.
  - **`seq` columns** (CONV-054) on `model_calls` and `jobs`, which the task's column
    list left out, and on `branches`, `bookmarks`, `assets`, and `asset_versions`, so
    no later migration adds them. 02-conventions Decisions.
  - **`model_calls.created_at` is INTEGER milliseconds**, with a 02-conventions Trap on
    WallTime strings. 01-architecture Decisions.
  - **Canon in two tables**, `canon` and `canon_templates`, with SCH-111's kinds plus
    `theme`; each kind's JSON is parsed with its content schema. 01-architecture
    Decisions.
  - **CONV-055 and ARCH-040 are checked by `source-rules.test.ts`**, not a lint rule,
    since `eslint.config.js` was changing in parallel branches. 02-conventions
    Decisions.
  - **Wall time:** the store uses the injected `TimeSource` (Mike's decision,
    CONV-061) for `touchLastPlayed` and the retention cutoff.
  - **API additions** to the design notes' list: `createCampaignStore` holds the
    connection cache (ARCH-022), with `closeCampaign` and `closeAll`, and takes
    `timeSource` and `modelCallRecordDays` (a getter, read at each open);
    `createCampaignFolder` takes the campaign record and writes its row;
    `insertRootTurn`; `listCanon`; `readSetsForRead(db, point)` takes the branch from
    the point; `writeState` takes its `createdAt`; `isOpen` on `Database`.
    `CampaignRecordSchema` and `PersistedJobSchema` are storage's own schemas.
  - **Invariant breaches throw** (CONV-041): a turn that isn't the head's child, a set
    on the wrong turn, superseding an inactive set or one on another turn, a second
    root turn, a corrupt row. `openCampaign` returns `not_found` for an ID that isn't a
    UUID or has no `campaign.sqlite`.
  - **02-conventions Traps:** a missing named parameter binds as NULL (`undefined` and
    `true` bind too); opening a missing file creates it; close before deleting on
    Windows; `@types/node` declares only the `…Sync` names; migrations run inside a
    transaction.
  - **01-architecture Open:** a database from a newer Mythos throws; no `ErrorCode`
    fits, so the client sees `internal_error`.
  - **Extra files** (CONV-132): `branches.ts`, `read-sets.ts`, `rebuild.ts`,
    `testing.ts`, and `source-rules.test.ts`.
- **Pending decisions:** None.
- **Not tested:**
  - ARCH-061: excluding records from exports; exports don't exist yet. Retention is
    tested.
  - PRV-062: re-enqueueing unfinished jobs when a campaign opens is the job queue's
    (P1-T13). Storing and listing them is tested.
  - TRN-003: rewind's and copy-on-write's rewrites of a depth range arrive with those
    operations in phase 2. Insert, fork, and the rebuild are tested.
- **Dependencies:** None. `node:sqlite` is built in (ADR-012), and the module uses only
  `zod`, `@mythos/contracts`, and `@mythos/core`, which `apps/server` already has.
