# P1-T19: Turn module: linear turns

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] A full turn with the mock adapter emits `turn.created`, `turn.status`, ordered `narration.delta`s, and `narration.done`, and commits two sets.
- [ ] TRN-149: Stop mid-stream commits the partial text with `complete: false` and the turn completes; Stop before any text abandons the turn and returns the input.
- [ ] TRN-052: a provider error after some text commits it with `complete: false`.
- [ ] TRN-058, TRN-120: a second action while narrating gets `turn_in_progress`; a stale `expectedHeadTurnId` gets `conflict`.
- [ ] TRN-012: restarting with a turn in `narrating` leaves it `stage-failed`, and retry completes it.
- [ ] TRN-150: fetching the turn mid-stream returns the text so far.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
