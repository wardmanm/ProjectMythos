# P1-T07: Server storage module

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] ARCH-050: opening a database twice runs each migration once; a migration that fails rolls back.
- [ ] ARCH-041: an error thrown inside `transaction` leaves no rows behind.
- [ ] TRN-003, ARCH-042: after inserting a chain of turns, a rebuild produces the same `branch_turns` rows.
- [ ] CONV-051: a row with a corrupt JSON column fails with a clear parse error, not a crash later.
- [ ] Deleting an open campaign works on Windows (CI).
- [ ] Storage tests each use a fresh database in `os.tmpdir()` (CONV-116).
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
