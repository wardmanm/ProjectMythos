# P1-T24: Client: settings and PIN screens

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T20, P1-T21 |
| **Branch** | `p1-t24-client-settings` |

## Goal

Edit machine config: providers with health, model profiles with probe, role
assignments, the PIN; and the PIN entry screen.

## Read

- `spec/14-ui.md` §8.6 (UI-088), §14
- `spec/05-providers.md` §2 (the schema and rules), §9
- `spec/03-contracts.md` §12 (CON-091), §14 (settings and session)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

UI-088, PRV-003, PRV-004, PRV-005, PRV-090, PRV-091, CON-091, CON-111, CTX-032

## Outputs

- `apps/client/src/features/settings/` (screen, sections, tests)
- `apps/client/src/features/pin/` (screen, test)

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- `apps/server/`

## Design notes

- Sections: Providers (with a health dot each, PRV-091), Model profiles (with model
  pickers from `listModels` and a **Probe** button showing the result and its
  suggestions), Roles (one picker per role; `npc-voice`, `illustrator`, and
  `speech-segmenter` show their fallback when empty), PIN (set, change, remove;
  localhost exemption), and Advanced (`context`, `world`, `memory`, `queue`,
  `retention`, with defaults shown).
- Secrets show as "set" when the response holds `SECRET_PLACEHOLDER`, with a control
  to replace them; an `{ env }` secret shows the variable name. Send the placeholder
  back untouched to keep a secret (CON-111).
- Saving shows every validation issue next to its field, using the issue paths in
  `details.issues` (CON-091), and says when a restart is needed (PRV-004). Setting
  the PIN never needs a restart.
- Warn on a text profile with a context window below 8,192 tokens (CTX-032).

## Acceptance

- [ ] Component tests: probe results render with suggestions; a save with two issues shows both at their fields; a restart notice appears when the port changes.
- [ ] The PIN screen logs in, shows the rate-limit message on `rate_limited`, and returns to the screen the player came from.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
