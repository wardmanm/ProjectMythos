# P1-T17: Campaign creation and the setup set

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
