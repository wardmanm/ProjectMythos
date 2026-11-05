# P1-T17: Campaign creation and the setup set

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T05, P1-T07, P1-T08 |
| **Branch** | `p1-t17-campaign-creation` |

## Goal

Create a campaign from a pack and scenario: the folder and database, the canon
snapshot, the root turn with its setup set built exactly as SCH-117 orders it, branch
`Main`, and the initial campaign state.

## Read

- `spec/04-content-schemas.md` §1 (SCH-005), §8.2 (SCH-073), §11 (SCH-110 to SCH-118)
- `spec/06-turn-engine.md` §5.6 (TRN-056, TRN-057), §2
- `spec/08-memory.md` §3 (MEM-010, MEM-030 to MEM-035)
- `spec/10-journal.md` JRN-022
- `spec/13-content-settings.md` CSET-020
- `spec/09-context.md` CTX-005
- `spec/03-contracts.md` §14 (`CreateCampaignCommand`, `CampaignView`, CON-112)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

SCH-005, SCH-110, SCH-111, SCH-112, SCH-113, SCH-116, SCH-117, SCH-118, TRN-056, CON-071, CON-112, MEM-010, MEM-034, MEM-035, JRN-022, CSET-020, CTX-005, ARCH-045

## Outputs

- `packages/core/src/state/setup.ts` and `setup.test.ts`: the pure setup-set builder
- `apps/server/src/modules/turn/`: `index.ts`, `create-campaign.ts`, `campaign-view.ts`, tests, `README.md`
- Additions to the storage module's API, if needed (see P1-T07's public API note)

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`
- Other server modules except through their public APIs

## Design notes

- **`buildSetup`** in `core` takes the loaded pack, scenario, chosen PC, ruleset, and an
  injected ID generator, and returns the setup commits in SCH-117's order plus any
  SCH-116 warnings. It turns `startingStatuses` into statuses with generated IDs and
  `inflictedAt` at the scenario's start (SCH-005). Validate the result with the fold's strict validation (TRN-070)
  before writing anything.
- **Phase 1 limits.** `pc.mode: 'created'` and a non-null `conversion` are rejected with
  `validation_failed` and the message "Player-created characters and stat conversion
  arrive with the new-campaign wizard (phase 8)." The ruleset must be the setting's
  default.
- **Order of work** in `createCampaign`: validate the whole command and report every
  issue (CON-112); create the folder and database; write the `campaign` row, the
  canon snapshot (definitions, runtime entities, canon Markdown, history,
  relationships, the scenario's opening file, and every file from the pack, tone
  profile, ruleset, and engine `templates/` folders, CTX-005), the first content-settings version from the tone
  profile (CSET-020), and branch `Main`; insert the root turn with the setup set and
  status `narrating`. The opening narration is started by P1-T19, which edits this
  file to call it.
- Build `CampaignView` and `CampaignSummary` (game time label via the calendar
  functions in `core`).

## Acceptance

- [ ] SCH-117: creating a campaign from *Arrival* produces a setup set whose commits, in order, match a checked-in snapshot (IDs from a seeded generator).
- [ ] MEM-034, MEM-035: Wren holds `told` grants for both letters and none for `merrow-lost`; Tomas holds a `rumor` grant for it; only Varek knows `merrow-scuttled`; only Jory knows `jory-rescued`.
- [ ] JRN-022: Wren knows Jory and Varek by name and nobody else.
- [ ] SCH-118: folding the setup set yields Wren and Odette at the Gull and Anchor at 18:00 on October 12, 1874.
- [ ] CON-112: a command with an unknown scenario and a missing tone profile reports both.
- [ ] `pnpm check` passes.

## Completion notes

- **Done:**
  - `packages/core/src/state/`: `setup.ts` and `setup-history.ts`, with 15 tests in
    `setup.test.ts` and `setup-history.test.ts`; `test-support.ts` gains `historyEntry`.
    `index.ts` exports `buildSetup` and the `SetupPack`, `SetupChoices`, and `Setup`
    types, and the README's `state/` section describes them.
  - `apps/server/src/modules/storage/`: `campaign-start.ts`, `writeCampaignStart`, with 2
    tests. `canon.ts` and `turns.ts` split `insertCanon` and `insertRootTurnRows` out of
    their transactions so it can reuse them; `index.ts` and the README list it.
  - `apps/server/src/modules/turn/`: `index.ts`, `create-campaign.ts`,
    `check-command.ts`, `snapshot.ts`, `campaign-view.ts`, `testing.ts`, and `README.md`,
    with 25 tests in four files and `__snapshots__/create-campaign.test.ts.snap`. The
    module exports `createCampaign`, `campaignView`, `listCampaignSummaries`, and the
    `CreateCampaignDeps` and `TurnLogger` types, and imports content and storage through
    their `index.ts`.
  - Acceptance, by test:
    - SCH-117: `creating a campaign from Arrival gives a setup set whose commits, in
      order, match the snapshot`, with seeded IDs and a fixed time source;
    - MEM-034, MEM-035: `Wren is told both letters and not of the loss; Tomas has it as
      rumor; only Varek and Jory know their secrets`;
    - JRN-022: `Wren knows Jory and Varek by name and nobody else`;
    - SCH-118: `folding the setup set yields Wren and Odette at the Gull and Anchor at
      18:00 on October 12, 1874`, whose view's label is `Monday, October 12, 1874
      (evening)`;
    - CON-112: `a command with an unknown scenario and a missing tone profile reports
      both, and nothing is written`.
  - Also by test: entity order with parents and containers moved up, the time advance,
    and the moves (SCH-117); starting statuses (SCH-005); removing a PC that is not
    chosen (SCH-113, SCH-116); witnessed grants (MEM-010, CON-071); the root turn's one
    setup set (TRN-056, SCH-112); fitting relationships to the ruleset (SCH-092); refusals
    of a created PC, a conversion, a non-default ruleset, and a scenario with no premade
    PC (SCH-110); every canon kind (SCH-111); templates by layer and path from a
    temporary pack and library (CTX-005); content settings (CSET-020); the view after the
    pack folder is deleted (ARCH-045); a setup set that fails validation leaves no folder
    (TRN-070); a write failure removes the folder, and an ID in use is refused (TRN-123).
  - `pnpm check` passes, after rebasing onto `origin/main` (`bff5ede`). The workspace has
    `Tests  605 passed (605)` and `spec/reference` `Tests  271 passed (271)`, and it ends
    with `Docs check passed: 834 requirements, 25 tasks (13 done), 20 ADRs, 83 markdown
    files, 834 citations in code.`
- **Rulings:**
  - **Mike's decisions** on the plan, 2026-11-05 (`P1-T17: spec: owner: setup warnings,
    MEM-035's inferred grants, GEAR-090 in phase 6`), each a Decisions row with Decided
    by `owner`:
    - setup's warnings (SCH-114, SCH-116, GEAR-090) are logged by campaign creation and
      returned by `buildSetup`, not stored. 04-content-schemas Decisions and Open;
    - MEM-035 is amended: `inferred` grants may also come from setup, through
      `alsoKnownBy`. 08-memory gains a Decisions section;
    - GEAR-090 is left for phase 6; until then a slot-schema override that lacks a worn
      slot fails creation with `illegal_state_change`. 04-content-schemas Decisions and
      Open, naming GEAR-090 and SCH-082. Tested as TRN-070.
  - **Spec fixes** (`P1-T17: spec: SCH-117's order, SCH-116's claims, one setup set, and
    creation rulings`), each a Decisions row with Decided by `Claude (ruling)`:
    - **SCH-117** (CONV-133): a parent place or container that sorts later moves up to
      just before the first entity inside it; one grant per knower, the first that
      applies; the PC's names in ID order. 04-content-schemas;
    - **SCH-116** (CONV-133): a claim left with no audience is dropped, a claim about a
      dropped entry gets `aboutObservationId: null`, and a PC that is not chosen leaves
      `presentEntityIds` too, each with a warning. 04-content-schemas;
    - **SCH-112 and TRN-056** said "setup sets"; both now say SCH-117's one set;
    - **SCH-111:** canon is the pack as loaded; the removals and the starting statuses
      exist only in the setup set. 04-content-schemas;
    - **the root turn's `gameTimeStart`** is the scenario's start. 06-turn-engine;
    - **theme and content settings:** the command's theme, else the tone profile's, else
      `theme.house` (UI-030); the command's content settings, else the tone profile's.
      03-contracts;
    - **`writeCampaignStart` is one transaction** after `createCampaignFolder`'s row, with
      an 01-architecture Open entry for a crash between the two.
  - **Extra files** (CONV-132, CONV-014): `check-command.ts`, `snapshot.ts`, and
    `testing.ts` in the turn module, `setup-history.ts` and `setup-history.test.ts` in
    core, and `campaign-start.ts` and its test in storage, so no file passes 300 lines.
  - **Other calls:**
    - template layers are read as `.md` files only, skipping dot-files, with LF line
      endings and no BOM; a missing folder has none. `content-library/templates/` does
      not exist yet, so the reference campaign snapshots no templates;
    - canon stores an entity with no canon Markdown as `markdown: null`, and history and
      relationships under the pack's ID;
    - the time advance's reason names the start date, such as `The scenario starts:
      Monday, October 12, 1874 (evening).`;
    - `createCampaign` refuses a campaign ID whose folder exists before making anything,
      so its clean-up never removes another campaign;
    - `createCampaign` returns `validation_failed` at `packId` for a missing pack too,
      where `loadPack` says `not_found`, as the plan has it.
  - **Tests also cite** TRN-123, ARCH-041, CSET-023, and UI-030, which the task does not
    list, for the transaction, list, and theme behavior they verify.
- **Pending decisions:** None.
- **Not tested:**
  - CON-112: queuing the opening narration arrives with P1-T19, which edits
    `create-campaign.ts` to start it. The checks and what is committed are tested.
- **Dependencies:** None.
