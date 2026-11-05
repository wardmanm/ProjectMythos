# P1-T05: World-state fold and commit validation

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
