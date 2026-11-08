# P1-T24: Client: settings and PIN screens

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
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

- [x] Component tests: probe results render with suggestions; a save with two issues shows both at their fields; a restart notice appears when the port changes.
- [x] The PIN screen logs in, shows the rate-limit message on `rate_limited`, and returns to the screen the player came from.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/client/src/features/settings/`, the settings screen (UI-088):
    - `settings-screen.tsx` loads `GET /settings` and shows the form, a failure, or,
      for a config that fails to load, `broken-config.tsx`: every issue with its path,
      and **Start from default settings**, which saves `defaultMachineConfig()`
      (`default-config.ts`, PRV-001) after a confirm. The restart notice (PRV-004)
      lives here, so it follows either kind of save.
    - `settings-form.tsx`: one draft and one Save (PRV-003), Discard, the issue summary,
      and the save bar; `settings-draft.ts` (the keyed draft, `configFrom`, item
      states, new items from the schemas); `field-issues.ts` (CON-091).
    - Sections: providers (`providers-section.tsx`, `provider-card.tsx`,
      `provider-type-fields.tsx`, `secret-field.tsx`, `headers-field.tsx`,
      `health-dot.tsx`); model profiles (`profiles-section.tsx`, `profile-card.tsx`,
      `model-picker.tsx`, `sampling-fields.tsx`, `probe-panel.tsx`); roles; devices;
      server (address, port, data folder); Advanced (`advanced-fields.ts`,
      `advanced-section.tsx`); and the PIN (`pin-section.tsx`).
    - `form-fields.tsx`, `section.tsx`, `issue-summary.tsx`, `schema-defaults.ts`, and
      the tests' helpers in `settings-testing.ts`.
  - `apps/client/src/features/pin/`: `pin-screen.tsx` and `safe-next.ts`.
  - `apps/client/src/api/`: the settings hooks below `useSettings()`, `session.ts`, and
    the `providerStatuses`, `providerModels`, and `session` keys.
  - 69 new tests: in settings, `settings-screen` (13), `providers-section` (9),
    `profile-card` (8), `settings-draft` (8), `pin-section` (6), `field-issues` (5),
    `roles-section` (4), and `advanced-section` (4); in pin, `pin-screen` (7) and
    `safe-next` (3); 2 more in `query-keys`.
  - Acceptance, by test (the checklist is ticked):
    - `PRV-090: probe results render with their suggestions`;
    - `CON-091: a save with two issues shows both at their fields`;
    - `PRV-004: a restart notice appears when the port changes`;
    - `ARCH-110: the PIN screen logs in and returns to the screen the player came
      from`, and `ARCH-110: a rate_limited answer says how long to wait`.
  - By hand, on macOS, with `pnpm build` and the server on a scratch data folder: the
    screen at 375 and 1440 px wide, with no sideways scrolling at 375; a probe of a
    mock profile with its report and suggestions; a port change saved to the file with
    the stored Anthropic key kept, and the restart notice. With a broken
    `machine-config.json`, the screen listed its issue, and **Start from default
    settings** replaced the file and showed the form: the server's `save` works while
    the stored config is broken, as its README says.
  - `pnpm check` passes on the branch rebased onto `main` at ced52ea (P1-T22 merged). The
    workspace has `Tests  1240 passed (1240)` and `spec/reference`
    `Tests  273 passed (273)`. It ends with `Docs check passed: 835 requirements, 25
    tasks (23 done), 21 ADRs, 87 markdown files, 1627 citations in code.`
- **Rulings:**
  - **Mike's decisions** (2026-11-07, `P1-T24: spec: owner:` commit, 14-ui Decisions):
    - Scope (Q1 A): devices and a Server section join the screen; explicit-content
      routing moves to phase 3, in 14-ui §15's phase-3 row; a role's sampling and a
      profile's `contextBudget` are carried through unshown.
    - The restart notice (Q2 A): after a save answering `restartRequired: true`, with
      the address, port, and data folder always saying "Needs a restart."; a
      05-providers Open item says a reload forgets the notice.
    - A broken config (Q3 B): its issues, and **Start from default settings** after an
      AlertDialog confirm.
    - The plan's rulings stand, and `PUT /settings` changing `server.pin` without ending
      sessions is an Open item for a server task.
  - **Where the PIN defect is recorded:** 01-architecture Open, not 05-providers:
    ARCH-110 and its Decisions row say what any PIN change must do to sessions, which
    is what `PUT /settings` skips.
  - **Extra files** (CONV-132): `src/api/settings.ts` (the hooks below `useSettings`),
    `src/api/session.ts`, `src/api/query-keys.ts` and its test, and
    `src/test/settings-fixtures.ts` (`providerStatuses`, `probeResult`,
    `sessionState`), since ARCH-122 and CONV-100 put data loading in `api/`; the
    client README (the hooks, the settings and PIN screens, the fixtures); and
    01-architecture's Open section.
  - **The settings screen** (14-ui Decisions): one draft and one Save; issues follow
    their item by a client key; saved ids and provider types are fixed; probe, model
    lists, and health wait for saved settings; the PIN changes only through
    `PUT /settings/pin`, its buttons wait while edits are unsaved, and the exemption
    changes only with Set or Change; CTX-032's 8,192 is copied into the client; the
    PIN screen returns to `safeNext(next)`.
  - **Server text** (14-ui Decisions, UI-122): issue messages, health `detail`, and
    probe `suggestions` are shown as they come; the README rule from 0b05692 needed no
    change.
  - **Smaller calls:**
    - The screen is not a `<form>`, since shadcn's `Button` submits one (14-ui Traps).
    - `useSaveSettings` and `useSetPin` start their refetch without waiting, so the
      caller hears of the save first (14-ui Traps); `useLogin` invalidates every query.
    - An unassigned role's Select value is `'(unassigned)'`, which no id can be.
    - A blank number field is null to its caller, and text that is no number is NaN,
      which the server reports at its field.
    - No new shadcn components: "More" and Advanced are native `<details>`.
    - The model can be typed as well as picked, so an unlisted model works.
    - The mock is offered as a provider type, for trying Mythos without a model;
      ComfyUI shows read-only until phase 9.
    - An Anthropic profile with thinking `off` warns, naming the provider's default
      (05-providers Decisions); its test cites UI-088. The headers field says an API key
      belongs under API key. Both 05-providers Open items are removed as done.
    - Read-only fields have a dashed border and muted text.
  - **Spec fixes:** none beyond Mike's decisions and the closing sections
    (`P1-T24: spec: closing sections for the settings and PIN screens`): 14-ui Traps,
    Decisions, and Open; 05-providers Open (the last save wins).
- **Pending decisions:** None.
- **Not tested:**
  - UI-088 (explicit-content routing): deferred to phase 3 by Mike's decision,
    2026-11-07.
- **Dependencies:** None.
