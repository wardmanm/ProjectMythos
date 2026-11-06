# P1-T19: Turn module: linear turns

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T18 |
| **Branch** | `p1-t19-turn-module` |

## Goal

Play: accept an action, stream narration, commit it, and handle failure, retry, and
Stop. Also run turn zero's opening narration and serve turn views.

## Read

- `spec/06-turn-engine.md` §3, §4, §5.1, §5.4, §5.6, §5.7, §9, §10, §11 (phase 1 row), §12 (`TurnView`, commands)
- `spec/05-providers.md` §4 (PRV-045 to PRV-047)
- `spec/03-contracts.md` §13
- `spec/01-architecture.md` §5 (ARCH-070)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

TRN-010, TRN-011, TRN-012, TRN-030, TRN-047, TRN-050, TRN-051, TRN-052, TRN-057, TRN-058, TRN-120, TRN-149, TRN-150, CTX-076, PRV-061, ARCH-070, ARCH-072, PRV-045, PRV-047, CON-100

## Outputs

- `apps/server/src/modules/turn/`: `submit-action.ts`, `narration.ts`, `turn-view.ts`, `read-point.ts`, tests; `create-campaign.ts` edited to start the opening narration

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`
- Other server modules except through their public APIs

## Design notes

- **Phase 1 path:** `submitAction` accepts `mode: 'ic'` only; `ooc` is rejected with
  `validation_failed` ("Out-of-character input arrives with adjudication in phase 3").
  It checks `expectedHeadTurnId` (TRN-120) and the waiting rules (TRN-058), then
  inserts the turn with its input set in one transaction (TRN-011), status
  `narrating`, and starts narration.
- **Narration job:** build the prompt (P1-T18), stream through `streamText`, publish
  `narration.delta` events with offsets, keep the text so far in memory for
  `GET /turns/:turnId` (TRN-150), then commit the narration set, based on the input
  set, and set status `complete`. `complete` on the commit is false when
  `finishReason` is `cancelled` or `length` (TRN-051). Failure before any text:
  `stage-failed`; failure after some text: commit it with `complete: false` and show
  the error (TRN-052).
- **Stop** aborts the `AbortController` the turn module passed to `streamText`
  (PRV-061). With no text yet, the turn is abandoned and the input returned (TRN-149,
  TRN-047); turn zero becomes `stage-failed` instead.
- **Turn zero:** after setup, run the same job for the root turn; its prompt uses the
  opening recipe (CTX-076).
- **Retry:** `regenerate` with stage `narration` is accepted only for a `stage-failed`
  head in phase 1.
- **Startup** (TRN-012): turns left `narrating` become `stage-failed`.
- `TurnView` fills `turn`, `gameTimeLabel`, `input`, and `narration`; every other field
  is empty or zero.

## Acceptance

- [x] A full turn with the mock adapter emits `turn.created`, `turn.status`, ordered `narration.delta`s, and `narration.done`, and commits two sets.
- [x] TRN-149: Stop mid-stream commits the partial text with `complete: false` and the turn completes; Stop before any text abandons the turn and returns the input.
- [x] TRN-052: a provider error after some text commits it with `complete: false`.
- [x] TRN-058, TRN-120: a second action while narrating gets `turn_in_progress`; a stale `expectedHeadTurnId` gets `conflict`.
- [x] TRN-012: restarting with a turn in `narrating` leaves it `stage-failed`, and retry completes it.
- [x] TRN-150: fetching the turn mid-stream returns the text so far.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/turn/`:
    - `submit-action.ts`: `submitAction`, and the head check and waiting rules that
      the retry shares;
    - `narration.ts`: `createNarrations`, the narrations in flight. Each run builds the
      prompt, streams it through `streamText`, forwards the deltas, and commits what
      arrived;
    - `narration-outcome.ts`: `narrationOutcome`, the pure decision on what a run
      leaves, and `fitDelta`, the 20,000-character cap;
    - `cancel-turn.ts`: `cancelTurn`, which handles Stop, and cancelling a failed turn;
    - `retry-narration.ts`: `regenerateStage`, which retries a failed narration, and
      `recoverInterruptedTurns` (TRN-012);
    - `turn-view.ts`: `turnView`, `turnViews`, and `branchViews`;
    - `read-point.ts`: `pointBefore`, `foldAtPoint`, and `checkSet`;
    - `deps.ts`: the shared types (`TurnDeps`, `Narrations`, and the command types,
      inferred from the contract schemas);
    - `create-campaign.ts`, which now starts the opening narration (TRN-057), and
      `campaign-view.ts`, which now folds through `read-point.ts`. Its calendar label
      is now `gameTimeLabeller`, shared with the turn views;
    - `index.ts`, `README.md`, `testing.ts`, and `play-testing.ts`, which is not
      exported. `play-testing.ts` builds the real event bus, job queue, mock adapter,
      model calls, and context module from public APIs, and records every event.
  - `packages/core`: `entriesInOrder(sets)` beside `orderSets` (Q2), with its TRN-061
    test, used by `context/read.ts` and `turn/read-point.ts`. The core and context
    READMEs are updated.
  - `apps/server/src/modules/storage`: `appendSet(db, set, status?)`, `abandonTurn`,
    `readTurnSets`, and `readTurnsWithStatus`, with tests and a README update.
  - 51 new tests:
    - `narration-outcome.test.ts` (6), `narration.test.ts` (13),
      `submit-action.test.ts` (8), `cancel-turn.test.ts` (7), `retry-narration.test.ts`
      (6), and `turn-view.test.ts` (4) in turn;
    - one more in `create-campaign.test.ts`, five in `storage/turns.test.ts`, and one
      in core's `turn-logic.test.ts`.
    - The play tests run through the real queue and the mock adapter.
  - Acceptance, by test (the checklist is ticked):
    - the full turn: `PRV-045: publishes turn.created, turn.status, its deltas in order
      at their offsets, and narration.done, and commits two sets`;
    - TRN-149: `Stop mid-stream commits the text so far with complete false, and the
      turn completes`, and `Stop before any text abandons the turn, moves the head back,
      and returns the input`;
    - TRN-052: `a provider error after some text commits that text incomplete,
      completes the turn, and shows the error`;
    - TRN-058, TRN-120: `a second action while the head is narrating gets
      turn_in_progress`, and `a stale expectedHeadTurnId is a conflict, and nothing is
      stored`;
    - TRN-012: `a turn a restart left narrating becomes stage-failed, and a retry
      completes it`;
    - TRN-150: `mid-stream, the turn holds the text streamed so far, marked
      incomplete`.
  - `pnpm check` passes on the branch, whose base is `main` at d118bca. The workspace
    has `Tests  1062 passed (1062)` and `spec/reference` has `Tests  271 passed (271)`.
    It ends with `Docs check passed: 834 requirements, 25 tasks (20 done), 20 ADRs, 84
    markdown files, 1385 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, while planning, 2026-11-06):
    - **Q1:** `POST /turns/:turnId/regenerate` returns `{ turnId }` for a stage that runs
      as an interactive job (adjudication, narration), and `{ jobId }` for a background
      stage (extraction). This is the 06-turn-engine §10 row, in `P1-T19: spec:
      regenerate returns { turnId } for an interactive stage`, with an `owner` row in
      06-turn-engine Decisions.
    - **Q2:** core's `entriesInOrder` is the one way a read point's sets are put in
      order, used by `context/read.ts` and `turn/read-point.ts`. That closes the
      09-context Open item on folding written twice.
  - **06-turn-engine Decisions, Claude (ruling):**
    - a narration commits only the text forwarded as deltas (TRN-051, TRN-052,
      CSET-050);
    - narration past 20,000 characters is cut there and committed incomplete (TRN-051);
    - a narrator that returns no text leaves the turn `stage-failed` (TRN-052);
    - `cancel` abandons a non-root `stage-failed` turn and returns any other turn that
      is not narrating unchanged (TRN-047, TRN-058, TRN-149);
    - at shutdown, partial text is committed and a turn with none is `stage-failed`
      (TRN-012, PRV-047);
    - a new turn's `gameTimeStart` is its parent's folded game time, `gameTimeLabel`
      is the turn's start, and an accepted action sets `lastPlayedAt` (TRN-011);
    - narration is based on the input set, or for the root on its setup set, with
      origin `model` (CON-083);
    - abandoning removes the turn's `branch_turns` row (TRN-047);
    - ARCH-070 checks the head's status and the campaign's running narrations;
    - phase 1 publishes no `state.changed`, and turn events carry IDs and a status only
      (CON-100).
  - **06-turn-engine Traps** (new section):
    - nested transactions, so a set and its status go through `appendSet(…, status)`;
    - no `await` between a command's checks and its writes;
    - an abandoned turn is on no branch;
    - the in-flight map clears before `narration.done`;
    - the queue retries retryable errors in tests.
  - **06-turn-engine Open:**
    - a failed stage's error is not kept in `TurnView`;
    - `failedStages` and `versionCounts` stay empty in phase 1;
    - abandoning publishes no `branch.changed`;
    - every read folds from the root until snapshots arrive.
  - **Extra files** (CONV-132):
    - `turn/deps.ts`, `cancel-turn.ts`, `retry-narration.ts`, and
      `narration-outcome.ts`, which keep each file to one job and under 300 lines;
    - `turn/play-testing.ts`, the shared play-test harness;
    - storage's `turns.ts`, `branches.ts`, `read-sets.ts`, and `index.ts`. Transactions
      don't nest, only storage writes `branch_turns` (ARCH-040), and an abandoned
      turn's sets can't be read by branch;
    - `context/read.ts` and core's `turn-logic.ts` (Q2);
    - the core, context, storage, and turn READMEs.
  - **Smaller calls:**
    - `turnViews` and `branchViews` are here, not in P1-T20, because that task's routes
      may only call module public APIs, and phase 1 needs `GET /branches` and `GET
      /branches/:branchId/turns`.
    - `submitAction` and `regenerateStage` are synchronous, and return a `Result`.
    - Error messages:
      - phase-1 refusals name the field and the phase that brings it: regenerating
        adjudication arrives in phase 3, and extraction in phase 4; an instruction,
        another model, an earlier turn, or finished narration in phase 2;
      - a refusal is `provider_rejected`, "The narrator's model refused to write this
        narration.";
      - an unexpected throw is `internal_error`, "Narration failed unexpectedly. Retry
        the turn.".
    - A player's Stop on a narration with no text publishes no `error`, only its new
      status.
    - While a turn waits for its first word, its view's narration is `{ text: '',
      complete: false }`, so the client applies deltas from offset 0 (UI-101).
- **Pending decisions:** None.
- **Not tested:**
  - ARCH-072: phase 1 has no extraction, so narration has nothing to be blocked on.
    Extraction and its job arrive in phase 4.
- **Dependencies:** None.
