# P1-T22: Client: library and new campaign

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T20, P1-T21 |
| **Branch** | `p1-t22-client-library` |

## Goal

The library screen and the minimal new-campaign form.

## Read

- `spec/14-ui.md` §2, §8.1 (UI-083), §14 (UI-120 to UI-123), §15 (phase 1 row)
- `spec/05-providers.md` PRV-001
- `spec/03-contracts.md` §14 (`CampaignSummary`, `PackSummary`, `CreateCampaignCommand`)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

UI-083, UI-123, CSET-023, PRV-001

## Outputs

- `apps/client/src/features/library/` (screen, components, tests)
- `apps/client/src/features/new-campaign/` (form, tests)

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- `apps/server/`
- `apps/client/src/api/` except adding hooks for these routes

## Design notes

- **Library** (UI-083): campaigns most recently played first, as a list on phones and a
  grid on desktop, each with name, setting, date in game, last played, and a
  one-line content summary (CSET-023). Continue opens `/c/:campaignId`. Delete asks
  for confirmation. Packs with issues are listed with their issues. The empty state
  says "Start your first campaign" with the reference pack preselected (UI-123).
- **New campaign** (phase 1 form, not the wizard): campaign name, pack, scenario, and
  the scenario's premade PC shown read-only; the tone profile and ruleset are the
  setting's defaults, shown but not editable. Submitting posts `CreateCampaignCommand`
  and opens the play screen, where the opening narration streams.
- While `GET /settings` shows no model profiles, open `/settings` instead of the
  library (PRV-001). If profiles exist but the narrator role is unassigned, show a
  notice linking to settings (UI-084's warning, early).

## Acceptance

- [ ] Component tests for the library with campaigns, without campaigns, and with a pack that has issues.
- [ ] Submitting the form sends the expected command and navigates to the new campaign.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
