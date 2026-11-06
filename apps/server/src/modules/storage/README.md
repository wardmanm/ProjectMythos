# storage

Every campaign database. It owns the `node:sqlite` wrapper, the migrations and the
first schema, campaign folders and their connections, and the repositories for turns,
sets, commits, branches, campaign state, canon, model call records, and jobs. It
imports no other module (ARCH-021): time, retention, and paths come in as parameters.

## Public API (`index.ts`)

**Campaigns.** `createCampaignStore({ dataDir, timeSource, modelCallRecordDays })` is
called once, by the composition root (ARCH-022), with the injected `TimeSource`
(CONV-061). The store holds one open connection per campaign, so no connection lives
in module state.

- `createCampaignFolder(campaign)` makes `<dataDir>/campaigns/<id>/` with `assets/` and
  `campaign.sqlite`, migrates it, writes the `campaign` row, and returns the
  connection.
- `openCampaign(id)` returns the cached connection, or opens, migrates (ARCH-050), and
  prunes model call records older than `modelCallRecordDays()` (ARCH-061). It returns
  `not_found` for an ID that is not a UUID or has no `campaign.sqlite`. A database from
  a newer Mythos throws, with a message that says so.
- `listCampaigns()`, `deleteCampaign(id)` (closes first, then removes the folder),
  `closeCampaign(id)`, `closeAll()`.
- `readCampaign(db)` and `touchLastPlayed(db)` read and update the `campaign` row.
  `CampaignRecordSchema` is its shape.

**Turns** (`turns.ts`). Each write is one transaction (ARCH-041), and storage assigns
every set's `seq` (CON-084). A commit's `seq` is its position in its set.

- `insertRootTurn(db, { branch, turn, sets })`: the first turn and the branch at it.
- `insertTurn(db, { branchId, turn, sets })`: a child of the branch head, with its
  sets, the new head, and its `branch_turns` row (TRN-011). The caller has already
  checked the expected head (TRN-120); a turn that isn't the head's child throws.
- `appendSet(db, newSet)`: a set on an existing turn. With `supersedesSetId`, the old
  set becomes inactive in the same transaction (TRN-001).
- `setTurnStatus`, `readTurn`, `readTurnsOnBranch(db, branchId, beforeDepth, limit)`.

**Campaign start** (`campaign-start.ts`). `writeCampaignStart(db, { canon, contentSettings,
branch, turn, sets, createdAt })` writes what a new campaign needs after its folder and
`campaign` row: the content snapshot, the first `content_settings` and
`current_branch_id`, and the root turn with its sets and the first branch, in one
transaction (TRN-123). It reuses `canon.ts`'s and `turns.ts`'s inserts, which run inside
the caller's transaction, since transactions do not nest.

**Reads** (`read-sets.ts`). `readSetsForRead(db, point)` returns the active sets inside
a read point (TRN-060), each with its commits and its turn's depth, sorted by depth,
then set `seq`, then commit `seq`. It does not sort by stage: core's `orderSets` is the
only definition of TRN-061's order, and the caller applies it before folding.

**Branches** (`branches.ts`). `createBranch` (with the `branch_turns` rows of its head's
ancestry, TRN-100), `readBranch`, `listBranches` (creation order). Not commits (TRN-002).

**Campaign state** (`campaign-state.ts`). `readState(db, key)`, `writeState(db, key,
value, createdAt)`, `readStateHistory(db, key)`. Keys: `current_branch_id` (TRN-101),
`content_settings` (CSET-020), and `template:<path>` for a campaign template override
(CTX-005). Each write adds a version.

**Canon** (`canon.ts`). `writeCanon(db, { entries, templates })` writes the content
snapshot once (SCH-111); `readCanon(db, kind, id)`, `listCanon(db, kind)`, and
`readTemplates(db)` read it. Kinds: `setting`, `calendar`, `slots`, `tone`, `ruleset`,
`scenario`, `theme`, `entity` (runtime form, with its Markdown), `history`, and
`relationships`; each is parsed with its content schema.

**Model calls and jobs.** `insertModelCall`, `listModelCalls(db, turnId)`,
`readModelCall`, `pruneModelCalls(db, olderThan)`; `insertJob`, `updateJob`,
`listUnfinishedJobs` (queued and running, in queue order, PRV-062).

**Rebuild.** `rebuildProjections(db)` rebuilds `branch_turns` and `commit_sets.active`
from the log (ARCH-042). Later phases add `replay_conflicts`.

**Driver.** `openDatabase(file)` and the `Database` type. Rows come back as `unknown`.

## Rules for code here

- Only `sqlite.ts` imports `node:sqlite` (CONV-055); `source-rules.test.ts` checks it.
- Every row is parsed with a schema from `rows.ts` through `parseRow`, which throws an
  error naming the table and row (CONV-051). JSON columns use `jsonColumn(schema)`.
- Bind every named parameter: a missing one binds as NULL. Bind booleans as 0 or 1.
- Only `turns.ts`, `branches.ts`, and `rebuild.ts` write `branch_turns`,
  `commit_sets.active`, or `replay_conflicts` (ARCH-040); `source-rules.test.ts`
  checks it.
- A new table or column is a new migration (CONV-052). Triggers keep `turns`,
  `commit_sets`, and `commits` append-only (TRN-001); see 06-turn-engine's Traps before
  adding a column to them.
- Tests use `createTestSpace()` from `testing.ts` and call `space.cleanUp()` after each
  test, which closes every database before removing its folder (CONV-116).

## Files

`sqlite.ts`, `migrate.ts`, `migrations/`, `rows.ts`, `campaigns.ts`, `turns.ts`,
`branches.ts`, `read-sets.ts`, `rebuild.ts`, `campaign-state.ts`, `canon.ts`,
`campaign-start.ts`, `model-calls.ts`, `jobs.ts`, and `testing.ts` (test helpers, not
exported).

## Governing spec

- [01-architecture.md](../../../../../spec/01-architecture.md) §4: the data directory,
  event sourcing, schema versioning, and model call records.
- [06-turn-engine.md](../../../../../spec/06-turn-engine.md) §2 and §6: the tables,
  TRN-001 to TRN-003, TRN-011, and read points.
- [02-conventions.md](../../../../../spec/02-conventions.md) §7: SQL, row parsing,
  migrations, IDs, and ordering.
- [03-contracts.md](../../../../../spec/03-contracts.md) §8, §10, §11, §14.1: the types
  stored.
- [ADR-003](../../../../../spec/decisions/ADR-003-hand-written-sql.md) and
  [ADR-012](../../../../../spec/decisions/ADR-012-node-sqlite.md).
