# turn

Turn pipeline orchestration ([01-architecture.md §3](../../../../../spec/01-architecture.md)).
It creates campaigns and plays linear turns: an in-character action is stored with its
input set, its narration streams to the client over SSE and is committed, and Stop,
failure, retry, and restart are handled. Turn zero runs its opening narration the same way.
It also builds the views the library and the play screen open. It imports `context`,
`providers` (types only), `content`, and `storage` through their `index.ts`, and its tests
use `events` and the rest of `providers` too (ARCH-021). Events are published through the
`publish` function it is given.

## Public API (`index.ts`)

**Wiring.** Everything stateful is in `createNarrations`, called once by the composition
root. Every command takes a `TurnDeps`: `{ store, publish, timeSource, newId, logger,
narrations }`. That is the campaign store, the event bus's `publish`, the injected
`TimeSource` (CONV-061), a UUID generator, a `TurnLogger` (`info`, `warn`, `error`, which
pino's logger fits), and the process's `Narrations`.

- `createNarrations(deps)` returns the `Narrations`. `deps` is a `NarrationDeps`:
  `{ store, publish, streamText, context, timeSource, newId, logger }`, where `streamText`
  comes from the providers module's `createModelCalls` and `context` is the
  `ContextDependencies` the context module needs (CTX-110).
  - `start({ campaignId, branchId, turnId, basedOnSetId })` runs a turn's narration in
    the background. The turn is already `narrating`.
  - `cancel(turnId)` stops a running narration as the player's Stop, and resolves once
    it has settled.
  - `textSoFar(turnId)` is the text streamed so far, or null when nothing is running
    (TRN-150).
  - `inFlight(campaignId)` says whether any narration of the campaign is running
    (ARCH-070).
  - `stop()`, at shutdown, before the queue's `stop()`: aborts every narration and
    resolves once each has settled. Text that arrived is committed, incomplete. A turn
    with none is left `stage-failed`.
- `recoverInterruptedTurns({ store, logger })`, at server start, before any request: every
  turn left `adjudicating` or `narrating` becomes `stage-failed` (TRN-012). A campaign
  that fails to open is logged and skipped. It returns how many turns changed.

**Commands.** Each command returns a `Result`. The command types are inferred from the
contract schemas (`SubmitActionCommand`, `CancelCommand`, `RegenerateStageCommand`).

- `createCampaign(deps, command)` creates a campaign from a `CreateCampaignCommand`, returns
  its `CampaignView`, and starts the opening narration (TRN-057). `deps` is a
  `CreateCampaignDeps`: `{ store, content, timeSource, newId, logger, narrations }`, where
  only `loadPack` of `content` and `start` of `narrations` are used. In order:
  1. `content.loadPack`. A missing pack, or one with problems, is `validation_failed`
     with one issue at `packId`.
  2. `checkCommand` (`check-command.ts`) reports every problem with the command at once
     (CON-112). Those problems are an unknown scenario, tone profile, or theme; a ruleset
     other than the setting's default; and a player-created PC, a stat conversion, or a
     scenario with no premade PC, which arrive in phase 8. It resolves three things:
     - the theme: the command's, else the tone profile's, else `theme.house`;
     - the content settings: the command's, else the tone profile's;
     - the slot schema: the tone profile's override, else the setting's.
  3. `buildSetup` from `core` builds the setup set, and `validateSet` checks it against
     the initial state (TRN-070). A failure is `illegal_state_change` with every issue.
  4. `snapshot.ts` reads the template folders of the tone profile, the pack, the ruleset,
     and the engine (CTX-005), and builds the canon entries (SCH-111).
  5. `store.createCampaignFolder` writes the folder and `campaign` row. Then storage's
     `writeCampaignStart` writes the rest in one transaction: the canon, the first
     `content_settings` (CSET-020) and `current_branch_id`, and the root turn on branch
     `Main`, status `narrating`, with its setup set. If either throws, the folder is
     deleted, the error logged, and the error rethrown. Every expected failure comes
     before this step.
  6. Setup's warnings (SCH-092, SCH-116) are logged, one entry each. The opening
     narration starts, based on the setup set.
- `submitAction(deps, campaignId, command)` returns `{ turnId }` as soon as the turn is
  stored (TRN-130). In order:
  1. `ooc` is `validation_failed` at `mode`, until phase 3.
  2. An unknown campaign or branch is `not_found`.
  3. A head other than `expectedHeadTurnId` is `conflict` (TRN-120).
  4. A head that is not `complete`, `extraction-failed`, or `world-tick-failed`, or any
     narration of the campaign still running, is `turn_in_progress` (TRN-058,
     ARCH-070).
  5. The input set is checked at the head (TRN-070). Then `insertTurn` stores the turn,
     `narrating`, with the head's folded game time as its `gameTimeStart`, its one
     `input.set` (origin `player`), and the new head, in one transaction (TRN-011,
     TRN-030). `touchLastPlayed` runs, `turn.created` and `turn.status` are published,
     and the narration starts.
- `cancelTurn(deps, campaignId, { turnId })` returns the turn's `TurnView` once things have
  settled (TRN-149, TRN-047):
  - a turn that is narrating is stopped;
  - a `stage-failed` turn that is not the root is abandoned;
  - any other turn comes back as it is.
  An abandoned turn's view holds its input, for the player to edit and send again.
- `regenerateStage(deps, campaignId, command)` retries a failed narration and returns
  `{ turnId }` (06-turn-engine §10). Phase 1 takes stage `narration` only, with no
  `instruction` or `profileId`, for a `stage-failed` head.
  - Anything else is `validation_failed`, at the field and naming the phase that brings
    it.
  - A narrating head is `turn_in_progress`.
  - A stale head is `conflict`.

**Views.**

- `turnView({ store, narrations }, campaignId, turnId)`, `turnViews(…, branchId, {
  beforeDepth, limit })` (oldest first, paging back from the head), and
  `branchViews(store, campaignId)`, for `GET /turns/:turnId`, `GET
  /branches/:branchId/turns`, and `GET /branches`.
  - A `TurnView` fills `turn`, `gameTimeLabel` (the turn's `gameTimeStart` in the
    campaign calendar), `input`, and `narration`. Every other part is empty or zero
    until its phase.
  - While a turn narrates, its `narration` is the text so far with `complete: false`
    (TRN-150).
- `campaignView(store, campaignId)` returns a campaign's `CampaignView`, or `not_found`.
- `listCampaignSummaries(store)` returns every campaign's `CampaignSummary`, most recently
  played first, by time rather than text.

The views come from the campaign's own database (ARCH-045). Folded state is read in one
way only, through `read-point.ts`. `foldAtPoint` reads the point's sets with
`readSetsForRead`, puts them in TRN-061's order with core's `entriesInOrder`, and folds
them from the campaign's initial state.

## A narration, step by step (`narration.ts`)

1. The context module builds the narrator's prompt at the turn's narration read point
   (TRN-050). The root turn's opens the story (CTX-076).
2. `streamText` runs it as an interactive job (PRV-061), with an `AbortController`
   that Stop and `stop()` abort.
3. Each delta is published as `narration.delta` at its `offset`, the length of the
   text so far (PRV-045). It is added to the in-memory text, which is the only text
   ever committed. The text stops at `narration.set`'s 20,000 characters: what doesn't
   fit is dropped, and the model is stopped as a length stop would be.
4. `narrationOutcome` (`narration-outcome.ts`, pure) decides what the end leaves:
   - **Commit** the text with `complete: true`, or `complete: false` after a length
     stop, a Stop, or the cap (TRN-051). After a failure or a refusal that came once
     some text had arrived, the commit is also `complete: false`, and the error is shown
     (TRN-052, CSET-050).
   - **Fail**: no text after an error, a refusal, a failed prompt, or a model that
     returned nothing. The turn becomes `stage-failed`, and an `error` event is
     published.
   - **Stopped**: no text after a Stop. A normal turn is abandoned (TRN-047). The root
     turn, or any turn at shutdown, becomes `stage-failed`.
5. A commit writes the narration set (origin `model`, based on the input set, or on the
   root's setup set) and status `complete` in one transaction, with `appendSet(…,
   'complete')`. Then `narration.done`, `turn.status`, and any `error` are published.
6. An unexpected throw is logged, and a turn still `narrating` becomes `stage-failed`
   with `internal_error`.

## Files

- **Production code:** `index.ts`, `deps.ts` (the shared types), `create-campaign.ts`,
  `check-command.ts`, `snapshot.ts`, `submit-action.ts`, `narration.ts`,
  `narration-outcome.ts`, `cancel-turn.ts`, `retry-narration.ts`, `read-point.ts`,
  `turn-view.ts`, and `campaign-view.ts`.
- **Test helpers** (not exported):
  - `testing.ts`. Its `deps().narrations` only records what it is asked to start.
  - `play-testing.ts`, which plays the reference campaign through the real event bus,
    job queue, mock adapter, model calls, and context module, from their public APIs.
    It records every event and can act in the middle of a stream.
  - `prompt-testing.ts`.
- **Snapshots:** the SCH-117 snapshot test's expected setup set is
  `__snapshots__/create-campaign.test.ts.snap`, made with seeded IDs and a fixed time
  source. A change to it is a change to the setup set.

`narrator-prompt.test.ts` and `narrator-layers.test.ts` test the context module's
narrator prompt end to end. They live here because lint keeps context's tests from
importing this module, which creates campaigns. `prompt-testing.ts` creates the
reference campaign with seeded IDs and plays turns on it by storing their sets. It
builds a context builder over the campaign, with fake dependencies. The preview
snapshots of every engine template, at turn zero and at the third turn, are
`__snapshots__/narrator-prompt/*.txt`. A change to one is a change to the prompt the
narrator gets (CONV-115).

## Rules for code here

- Tests make their data directories in fresh `os.tmpdir()` folders through
  `createTestSpace()`, or `createPlaySpace()`, and clean up after each test. `space.cleanUp()`
  closes every database before removing its folder (CONV-116). A play space's `cleanUp()`
  stops its narrations and queues first.
- Every expected failure is found before the campaign folder is made, so a refused
  command never leaves a folder behind.
- A command's checks and its writes run with no `await` between them, so two commands
  can never both pass the waiting rules. Transactions don't nest, so a stage's set and
  the status it leads to are written together through `appendSet(db, set, status)`.
- The text committed is the text sent to the client. Never commit `StreamedText.text`
  itself, which can hold a refusal's words.

## Governing spec

- [06-turn-engine.md](../../../../../spec/06-turn-engine.md) §2 to §5, §9 to §12, and its
  Traps, Decisions, and Open sections.
- [05-providers.md](../../../../../spec/05-providers.md) §4 (PRV-045 to PRV-047) and
  PRV-061.
- [04-content-schemas.md](../../../../../spec/04-content-schemas.md) §11: campaign
  creation, SCH-110 to SCH-118, and its Decisions and Open sections.
- [03-contracts.md](../../../../../spec/03-contracts.md) §13 (the events and CON-100) and §14:
  `CreateCampaignCommand`, `CampaignView`, `CampaignSummary`, and CON-112.
- [01-architecture.md](../../../../../spec/01-architecture.md) §5 (ARCH-070 to ARCH-072).
- [08-memory.md](../../../../../spec/08-memory.md) §3, and
  [10-journal.md](../../../../../spec/10-journal.md) JRN-022.
- [09-context.md](../../../../../spec/09-context.md) CTX-005 and CTX-076, and
  [13-content-settings.md](../../../../../spec/13-content-settings.md) CSET-020 and CSET-050.
