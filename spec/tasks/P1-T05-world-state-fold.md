# P1-T05: World-state fold and commit validation

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T04 |
| **Branch** | `p1-t05-world-state-fold` |

## Goal

Write the pure fold that turns commit sets into world state, and the strict
validation that guards every new set. Phase 1 needs reducers for the commit types that
setup and linear turns write; the structure must make adding the rest routine.

## Read

- `spec/03-contracts.md` §7, §8, §10 (including §10.1, §10.2)
- `spec/06-turn-engine.md` §6 (TRN-060 to TRN-074)
- `spec/04-content-schemas.md` §11 (SCH-117, SCH-118)
- `spec/13-content-settings.md` CSET-044, CSET-063
- `spec/reference/core/turn-logic.ts` and its test

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

CON-005, CON-070, CON-071, CON-073, CON-080, CON-081, CON-082, CON-083, CON-084, CON-085, TRN-061, TRN-064, TRN-065, TRN-070, TRN-071, SCH-118, CSET-044, CSET-063

## Outputs

- `packages/core/src/state/turn-logic.ts`: `orderSets` and `activeSets` ported, with tests
- `packages/core/src/state/`: `folded-state.ts` (folded state type, `initialState`), `apply-commit.ts` (reducers), `validate.ts` (strict-on-write checks), and `fold.ts`, with tests. The folder has no `index.ts` of its own (CONV-015)
- `packages/core/src/index.ts` exports

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`

## Design notes

- **Folded state** (internal to `core`, TRN-064): `world: WorldState`; `relationships`
  keyed by `fromId>toId`; `names`: for each knower, the latest name learned for each
  entity (from `knowledge.name`, used for display names); `knownObservationIds`.
  Keep it plain data (records and arrays, no `Map` or `Set`) so it can be stored as a
  snapshot later.
- **Reducers in phase 1:** `entity.create`, `entity.move`, `item.move`, `time.advance`,
  `scene.start`, `flag.set`, `relationship.set`, `knowledge.name`, `observation.add`
  and `knowledge.grant` (record IDs and check references only; their row projections
  arrive in phase 4), `input.set` and `narration.set` (no state change). Every other
  type goes through an exhaustive `switch` that throws a clear error naming the
  phase that implements it, so nothing is silently ignored.
- **Validation** returns every issue, never just the first: the stage allowlist
  (03-contracts §10.2); references exist and have the right kind; `item.move` through
  `validateItemMove` from `gear.ts`; relationship dimensions and ranges from the
  ruleset (CON-073); `entity.create` on an existing ID is rejected, which is what keeps
  `ageCategory` fixed (CSET-044).
- `fold(state, orderedCommits, context)` returns `{ state, conflicts }`: lenient replay
  (TRN-071) skips a commit that fails validation and records it. Application order
  is TRN-061's, computed with `orderSets`: stage, then the set's `seq` (CON-084).
- The context passed to reducers and validation (ruleset, slot schema) is a parameter;
  `core` stays pure.

## Acceptance

- [ ] TRN-065: folding the same commits twice gives identical state and conflicts (deep equality).
- [ ] A hand-built setup set for a two-character, one-item world folds to the expected `WorldState`.
- [ ] CSET-063: a test over every commit payload type shows none can change `ageCategory`, and `entity.create` on an existing ID is rejected.
- [ ] TRN-070: a set with three different violations reports all three.
- [ ] An unimplemented commit type throws an error naming its phase.
- [ ] `pnpm check` passes.

## Completion notes

- **Done:**
  - `packages/core/src/state/`: `turn-logic.ts`, `folded-state.ts`, `apply-commit.ts`,
    `commit-allowlist.ts`, `validate.ts`, and `fold.ts`, each with its tests (48 in
    all), and `test-support.ts`, the builders those tests share. `index.ts` exports
    `activeSets`, `orderSets`, `staleStages`, `FoldedState`, `FoldContext`,
    `initialState`, `relationshipKey`, `applyCommit`, `commitIssues`, `CommitSetEntry`,
    `fold`, and `validateSet`. The README has a `state/` section.
  - Acceptance, by test:
    - TRN-065: folding the same sets twice, one commit of them a conflict, gives
      deep-equal state and conflicts;
    - a hand-built setup set (a town and its inn, Wren and Odette, Wren's satchel, a
      time advance, a move, a scene, an observation with its grants, a relationship,
      and a name) folds to the expected `WorldState`, the same through `fold` and
      `validateSet` (`SCH-118, TRN-065`);
    - CSET-063: of the 36 payload types, only `entity.create`'s JSON schema has an
      `ageCategory`. CSET-044: creating `pc.wren` again, as a minor, is rejected;
    - TRN-070: a set with a stage violation, a missing place, and full hands is
      rejected with all three, each at its path, and returns no state;
    - CON-085: one type from each later phase throws `<type> arrives in phase N`.
  - `pnpm check` passes, after rebasing onto the merges of P1-T09, P1-T16, P1-T10, and
    P1-T07. The workspace has `Tests  399 passed (399)` and `spec/reference` `Tests  271
    passed (271)`, and it ends with `Docs check passed: 834 requirements, 25 tasks (10
    done), 19 ADRs, 80 markdown files, 521 citations in code.`
  - At the rebase, P1-T07's and this task's 06-turn-engine Decisions rows on TRN-061's
    order were the same decision of Mike's, so they are one row.
- **Rulings:**
  - **Mike's decisions** (`P1-T05: spec: owner: TRN-061's order, CON-073's factions,
    TRN-064's later parts`), each a row in its document's Decisions:
    - `orderSets(sets, depthByTurnId)` is the only definition of TRN-061's order.
      Storage returns sets with their turn's depth and doesn't sort them by stage, and
      the fold doesn't sort them again (06-turn-engine). P1-T07 updates its own task file;
    - CON-073 allows relationships between characters only, until the ruleset has a
      switch for factions (03-contracts, with an Open entry);
    - TRN-064's wiki sections, notes, and beliefs arrive with their reducers in phases 4
      and 5 (06-turn-engine, with an Open entry).
  - **Mike's decision on the first pending question** (`P1-T05: spec: owner:
    override.record in any set that supersedes another`): 03-contracts §10.2 allows
    `override.record` in a set with origin `player` or a non-null `supersedesSetId`,
    TRN-080 says a regenerated set keeps origin `model`, and a 03-contracts Decisions
    row records it. `stageIssues` follows it, tested as TRN-080.
  - **Spec fixes** (`P1-T05: spec: TRN-064 names, consolidation grants, TRN-080, fold
    rulings`):
    - **TRN-064:** the folded state also holds the latest name each knower learned
      (JRN-020), which display names need;
    - **03-contracts §10.2:** `knowledge.grant` is allowed in consolidation sets. The
      table rejected MEM-105's summary grants and CON-071's witness grants there;
    - **TRN-080:** only the sets that edits and regenerations create carry an
      `override.record`. As written it covered every player-origin set, but the input
      set holds only its `input.set` (TRN-030). Mike then decided which sets may hold
      one (Pending decisions);
    - **03-contracts Decisions:** CON-071 is a write-time set check, and the set
      builders (setup, extraction) add the grants; a `null` summary in
      `relationship.set` leaves the summary unchanged, and a `null` value in `flag.set`
      removes the flag;
    - **03-contracts Decisions: an `illegal_state_change`'s `details` is
      `{ issues: SemanticIssue[] }`.** The plan said a bare `SemanticIssue[]`; CON-091
      already gives `validation_failed` this shape, so the client reads both alike;
    - **06-turn-engine Decisions:** validation steps through a set commit by commit, so
      a commit sees the earlier ones in its set. Open: phase 2's `POST /state` accepts
      every payload type, and a type without a reducer throws until its phase.
  - **SCH-117, spec fix** (`P1-T05: spec: SCH-117: a parent place comes before the places
    inside it`). Stepping through a set checks a place's `parentPlaceId` against the
    places already created, and sorting places by ID alone can put a child first
    (`place.inn` before `place.town`). Containers already had this exception. The
    reference pack's places sort parents first, so its setup does not change.
  - **Changes from the plan:**
    - `applyCommit(state, payload)` takes no context. No phase-1 reducer needs the
      ruleset, lint rejects an unused parameter, and 01-architecture §2.1 already
      writes it `applyCommit(state, commit)`. The first reducer that needs the ruleset
      (`relationship.adjust`'s clamp, phase 4) adds it;
    - the 24 types without a reducer are caught before the `switch` by their row in
      `UNBUILT_PHASES`, not as 24 case labels, which kept `applyCommit` under 50 lines.
      The `switch`'s `never` default still fails to compile on a new type with neither
      a case nor a row;
    - `stageIssues(type, set, ruleset)` returns `string[]`, like the other `…Issues`
      functions;
    - `fold` and `validateSet` apply a set's commits in `seq` order (CON-084's last
      key); an issue's path uses the commit's index in the entry as given;
    - `item.move`'s `ownerId` is checked like `entity.create`'s: a pc, npc, or faction;
    - CON-070 is checked as the biconditional it is: an event with an empty
      `summarizesIds` passes, one that summarizes something does not.
  - **Extra files** (CONV-132): `commit-allowlist.ts`, the §10.2 table as
    `Record<CommitType, …>`, so a new type fails to compile without a row (CON-085);
    and `test-support.ts`, builders shared by six test files. It does no IO, so core's
    lint applies to it, and `index.ts` does not export it.
  - **Scope:** `staleStages` is ported because CON-083 is listed; a created item's
    location is gear-checked like a move; copy-on-write remapping stays in
    `spec/reference` until phase 2, with its tests.
  - **Changes from the reference:** `orderSets` takes the turns' depths, since the
    reference ignored depth and would put turn 2's input before turn 1's narration, and
    it throws for a set whose turn has no depth.
  - **Tests also cite CON-041, CON-042, and TRN-056,** which the task does not list, for
    the reference-kind, item-move, and setup-allowlist checks they verify.
- **Pending decisions:**
  - **Regeneration sets and `override.record` (TRN-080, 03-contracts §10.2).** Not
    blocking: `override.record` arrives in phase 2. TRN-080 puts an `override.record`
    with the player's instruction in a regenerated set, but that set's origin is
    `model` (or `engine` for resolution, §7.1), and §10.2 allows `override.record`
    only in sets with origin `player`, which `stageIssues` enforces. Options:
    1. allow `override.record` in any set that supersedes another, whatever its
       origin (recommended: edits and regenerations are exactly those sets);
    2. give a set regenerated at the player's request origin `player`, though the
       model wrote it;
    3. keep the instruction out of the commit log, on the regeneration's job.

    Decided 2026-11-05: option 1. `override.record` is allowed in any set with origin
    `player` or a non-null `supersedesSetId`, so a regeneration stays origin `model`
    and still records the player's instruction (03-contracts §10.2 and Decisions,
    TRN-080).
  - **A claim about a later history entry (SCH-090, SCH-117).** Not blocking for this
    task; it matters to P1-T08 and P1-T17. SCH-090 lets a claim's `aboutRef` name any
    entry, setup adds history in file order (SCH-117 step 4), and validation requires a
    claim's `aboutObservationId` to be added earlier. The reference pack's claims name
    earlier entries, so it passes. Options:
    1. SCH-090 requires `aboutRef` to name an earlier entry, and the pack loader
       reports one that doesn't (recommended: one rule, checked where authors see it);
    2. setup adds an entry a claim is about before the claim, otherwise in file order;
    3. validation lets `aboutObservationId` name an observation added later in the same
       set.

    Decided 2026-11-05: option 1. A claim's `aboutRef` must name an earlier history
    entry; P1-T08 amends SCH-090 and adds the pack loader's check. This task needs no
    change, and P1-T17's setup can rely on it: adding history in file order always adds
    a claim's target first. The reference pack's two claims both point at the first
    entry, `merrow-lost`.
- **Not tested:** None. Every listed behavioral requirement has a test named by its ID.
- **Dependencies:** None.
