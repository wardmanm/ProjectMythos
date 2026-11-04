# P1-T25: Phase acceptance: end-to-end tests and README

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T01 to P1-T24 |
| **Branch** | `p1-t25-phase-acceptance` |

## Goal

Prove phase 1 works end to end in CI on both operating systems, and write the README
a newcomer follows. The owner's sign-off in `phases/phase-1.md` (CONV-139) comes after
this task.

## Read

- `spec/phases/phase-1.md`
- `spec/14-ui.md` §16 (UI-131)
- `spec/05-providers.md` §8 (PRV-080 to PRV-084)
- `spec/02-conventions.md` CONV-086, CONV-113, CONV-114

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

UI-131, PRV-082, PRV-083, CONV-086, OVR-001, OVR-002, OVR-005

## Outputs

- `apps/client/e2e/`: Playwright tests and config
- `apps/server/src/cli/record-fixtures.ts` and its `record-fixtures` script (PRV-082, ARCH-007)
- `.github/workflows/check.yml` and root `package.json`: the end-to-end run added to CI
- Root `README.md`: install, first run, configure a model, play, PIN, data folder, troubleshooting

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- Application code, except to fix defects found here, each listed under Rulings

## Design notes

- **End-to-end tests** (Playwright with `@axe-core/playwright`) build and start the app
  with a temporary data folder and a config whose narrator uses the `mock` provider in
  default mode with a `delayMs` of about 50 (PRV-083), so no recorded fixtures are
  needed and Stop has time to land. They create the
  reference campaign, read the opening, play two turns, Stop a third mid-stream, open
  the inspector, and set a PIN and log in from a fresh browser context.
- Run them at 390 × 844 and 1440 × 900 in the house theme, with an axe check on each
  phase-1 screen and a check for horizontal scrolling (UI-131 for phase 1).
- **`record-fixtures`** (PRV-082) records mock fixtures for a named scenario from a real
  profile given on the command line, overwriting only that scenario. Later phases use
  it; phase 1 only needs it to work.
- The README must get someone from a fresh clone to playing on Windows or macOS
  without reading the spec.

## Acceptance

- [ ] CI is green on `windows-latest` and `macos-latest`, including the end-to-end tests.
- [ ] The axe checks report no serious issues on any phase-1 screen at either size.
- [ ] `record-fixtures` writes a scenario's fixtures from a real profile (tried by hand; note the model used in the completion notes).
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
