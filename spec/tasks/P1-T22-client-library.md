# P1-T22: Client: library and new campaign

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
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

- [x] Component tests for the library with campaigns, without campaigns, and with a pack that has issues.
- [x] Submitting the form sends the expected command and navigates to the new campaign.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - **The library** (`apps/client/src/features/library/`), at `/`:
    - `LibraryScreen`: PRV-001's first-start gate, the narrator notice, the campaigns or
      the empty state, and the packs with errors. It shows "Opening the library…" until
      settings fetched since it opened have answered.
    - `CampaignCard`: name, setting, date in game, last played (`<time dateTime>`),
      and the content summary, with Continue (primary) and Delete (quiet). The cards
      are one column on phones, two from 640 px, and three from 1024 px.
    - `DeleteCampaignDialog`, `PackErrors`, `contentSummary` (CSET-023), and
      `settingsGate` with `NarratorNotice` (`first-start.tsx`).
  - **The form** (`apps/client/src/features/new-campaign/`), at `/new`:
    - `NewCampaignScreen` loads the packs and settings, then shows the form, or says
      no pack can start a campaign.
    - `NewCampaignForm` has the name, pack, and scenario fields, and shows the premade
      PC, tone profile, and ruleset read-only. Start posts the command, then replaces
      the address with `/c/:campaignId`. Each issue shows at its field, or above Start.
    - `choices.ts` holds `startablePacks`, `defaultPackId`, `premadeScenarios`,
      `suggestedName`, and `commandFor`; `form-fields.tsx` the labelled fields.
  - **Hooks** (`src/api/`): `useCampaigns`, `useCreateCampaign`, and
    `useDeleteCampaign` in `campaigns.ts`; `usePacks` in the new `library.ts`; the
    `packs` key. They build on the shared commit `0b05692` (`useSettings`,
    `validationIssuesOf`, `machineConfig`).
  - Acceptance, by test: the library with campaigns, without, and with a broken pack in
    `library-screen.test.tsx`; the command and the navigation in
    `new-campaign-screen.test.tsx` (SCH-110, CON-112).
  - `pnpm check` passes on `2174066`, which `main` still is. The workspace has
    `Tests  1171 passed (1171)` and `spec/reference` `Tests  273 passed (273)`, and it
    ends with `Docs check passed: 835 requirements, 25 tasks (22 done), 21 ADRs, 87
    markdown files, 1542 citations in code.`
  - `pnpm build` succeeds, with Vite's usual warning that the one script chunk is over
    500 kB.
- **Rulings:**
  - **Mike's decisions (2026-11-07)**, recorded as owner Decisions rows in the
    `P1-T22: spec:` commit:
    - UI-083's theme swatch is deferred to phase 8. 14-ui §15's phase-8 row lists it,
      and a 14-ui Decisions row says why.
    - PRV-001's redirect lives in the library and replaces the address.
    - The delete outcomes.
    - What the phase-1 form offers. The row also says a pack whose scenarios all need
      a player-created PC is listed but can't start, with the reason shown. This follows
      from "only scenarios with a premade PC", and works as the toneless setting does.
    - CSET-023's summary wording, a 13-content-settings Decisions row.
  - **The library's list** (14-ui Decisions): the server's order is kept. Create and
    delete refetch `['campaigns']`, since no event stream covers the library. A delete
    settles once the list is back, so the card is gone when the dialog closes, and it
    drops the deleted campaign's own queries.
  - **14-ui Traps:** settings cached before a profile was saved would send the player
    back to Settings, so the library acts only on `isFetchedAfterMount`. Tests read last
    played from `dateTime`, since the words depend on the device's locale.
  - **Spec fix (CONV-133):** 13-content-settings §8 listed the library summary
    (CSET-023) under phase 8, but this phase-1 task lists CSET-023. It moves to the
    phase-1 row.
  - **Extra files (CONV-132):**
    - `src/api/query-keys.ts`: the `packs` key, since UI-100 has `queryKeys` name every
      key.
    - `apps/client/README.md` (CONV-134).
    - The closing sections of `spec/14-ui.md` and `spec/13-content-settings.md`.
    - The shared commit `0b05692`, written for this task and P1-T24:
      `src/api/settings.ts`, `src/api/validation-issues.ts` and its test,
      `src/test/settings-fixtures.ts`, the `settings` key and its test, and the README's
      message rule.
  - **Helpers in the feature folders:**
    - `features/library/testing.ts` holds the campaign and pack builders, which the
      form's tests also use.
    - `features/new-campaign/form-fields.tsx` keeps the form under 300 lines.
    - The form reads issues with the shared `validationIssuesOf`, not a file of its own.
  - **Smaller calls:**
    - A failed `GET /packs` leaves the library's pack list out. The campaigns still
      show, and the form shows the failure.
    - The form's narrator notice reads the cached settings, since it only warns.
    - The suggested name uses the setting's name, else the pack's, cut to 80
      characters.
    - The client sends the name trimmed, and catches a blank one itself: "Give the
      campaign a name."
  - **Extra citations:** SCH-102, SCH-110, CON-112, and UI-122 in test names, and
    CON-091 in the shared commit's tests.
- **Pending decisions:** None.
- **Not tested:**
  - UI-083 (theme swatch): deferred to phase 8 by Mike's decision, 2026-11-07.
  - UI-083 (layout): jsdom does no layout, so the test reads the grid's classes.
- **Dependencies:** None.
