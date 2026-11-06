# turn

Turn pipeline orchestration ([01-architecture.md §3](../../../../../spec/01-architecture.md)).
So far it creates campaigns, from a pack's scenario to a root turn waiting for its opening
narration, and builds the views the library and the play screen open. It imports `content`
and `storage` through their `index.ts` (ARCH-021).

## Public API (`index.ts`)

- `createCampaign(deps, command)` creates a campaign from a `CreateCampaignCommand` and
  returns its `CampaignView`. `deps` is `{ store, content, timeSource, newId, logger }`:
  the campaign store, the content module (only `loadPack` is used), the injected
  `TimeSource` (CONV-061), a UUID generator, and a `TurnLogger` (`info`, `warn`, `error`,
  which pino's logger fits). In order:
  1. `content.loadPack`. A missing pack, or one with problems, is `validation_failed`
     with one issue at `packId`.
  2. `checkCommand` (`check-command.ts`) reports every problem with the command at once
     (CON-112): an unknown scenario, tone profile, or theme; a ruleset other than the
     setting's default; a player-created PC, a stat conversion, or a scenario with no
     premade PC, which arrive in phase 8. It resolves the theme (the command's, else the
     tone profile's, else `theme.house`), the content settings (the command's, else the
     tone profile's), and the slot schema (the tone profile's override, else the
     setting's).
  3. `buildSetup` from `core` builds the setup set, and `validateSet` checks it against
     the initial state (TRN-070). A failure is `illegal_state_change` with every issue.
  4. `snapshot.ts` reads the template folders of the tone profile, the pack, the ruleset,
     and the engine (CTX-005) and builds the canon entries (SCH-111).
  5. `store.createCampaignFolder` writes the folder and `campaign` row, then storage's
     `writeCampaignStart` writes the rest in one transaction: canon, the first
     `content_settings` (CSET-020) and `current_branch_id`, and the root turn, status
     `narrating`, with its setup set on branch `Main`. If either throws, the folder is
     deleted, the error logged, and rethrown. Every expected failure comes before this
     step.
  6. Setup's warnings (SCH-092, SCH-116) are logged, one entry each.
- `campaignView(store, campaignId)` returns a campaign's `CampaignView`, or `not_found`.
- `listCampaignSummaries(store)` returns every campaign's `CampaignSummary`, most recently
  played first, by time rather than text.

Both views come from the campaign's own database (ARCH-045): its row, its canon, its
campaign state, and the head of its current branch, read with `readSetsForRead`, put in
order with `orderSets`, and folded. `gameTimeLabel` is that head's game time in the
campaign's calendar.

## Files

`index.ts`, `create-campaign.ts`, `check-command.ts`, `snapshot.ts`, `campaign-view.ts`,
and `testing.ts` (test helpers, not exported). The SCH-117 snapshot test's expected
setup set is `__snapshots__/create-campaign.test.ts.snap`, made with seeded IDs and a
fixed time source; a change to it is a change to the setup set.

`narrator-prompt.test.ts` and `narrator-layers.test.ts` test the context module's
narrator prompt end to end, here because lint keeps context's tests from importing this
module, which creates campaigns. `prompt-testing.ts` (not exported) creates the reference
campaign with seeded IDs, plays turns on it by storing their sets, and builds a context
builder over it with fake dependencies. The preview snapshots of every engine template,
at turn zero and at the third turn, are `__snapshots__/narrator-prompt/*.txt`; a change
to one is a change to the prompt the narrator gets (CONV-115).

## Rules for code here

- Tests make their data directories in fresh `os.tmpdir()` folders through
  `createTestSpace()` and call `space.cleanUp()` after each test, which closes every
  database before removing its folder (CONV-116).
- Every expected failure is found before the campaign folder is made, so a refused
  command never leaves a folder behind.

## Governing spec

- [04-content-schemas.md](../../../../../spec/04-content-schemas.md) §11: campaign
  creation, SCH-110 to SCH-118, and its Decisions and Open sections.
- [03-contracts.md](../../../../../spec/03-contracts.md) §14: `CreateCampaignCommand`,
  `CampaignView`, `CampaignSummary`, and CON-112.
- [06-turn-engine.md](../../../../../spec/06-turn-engine.md) §2, §5.6, and §6.4.
- [08-memory.md](../../../../../spec/08-memory.md) §3, and
  [10-journal.md](../../../../../spec/10-journal.md) JRN-022.
- [09-context.md](../../../../../spec/09-context.md) CTX-005, and
  [13-content-settings.md](../../../../../spec/13-content-settings.md) CSET-020.
