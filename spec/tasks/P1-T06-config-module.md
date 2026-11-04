# P1-T06: Server config module

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T02 |
| **Branch** | `p1-t06-config-module` |

## Goal

Resolve the data directory, load and validate machine config, write the default on
first start, save edits atomically, and keep secrets out of every response.

## Read

- `spec/01-architecture.md` §3, §4.1 (ARCH-030 to ARCH-032)
- `spec/05-providers.md` §2 (all), §7 (PRV-071)
- `spec/03-contracts.md` §12 (CON-091), §14 (CON-111, `SECRET_PLACEHOLDER`)
- `spec/02-conventions.md` §9, §10

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-030, ARCH-032, PRV-001, PRV-002, PRV-003, PRV-004, PRV-005, CON-091, CON-111, CONV-072, CONV-080, CONV-085

## Outputs

- `apps/server/src/modules/config/`: `index.ts`, `data-dir.ts`, `machine-config.ts`, `secrets.ts`, `cross-references.ts`, tests, `README.md`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other server modules

## Design notes

- **Data directory.** Default per OS: `%APPDATA%\Mythos` on Windows,
  `~/Library/Application Support/Mythos` on macOS, and `$XDG_DATA_HOME/mythos` (or
  `~/.local/share/mythos`) elsewhere, for development containers. Write the resolver as
  a pure function of `(platform, env, homedir)` so tests cover all three on any OS.
- **Where the config file lives.** `machine-config.json` is in the directory given by
  `--data-dir`, else the OS default. Its `dataDir` field, when set, moves everything
  else (campaigns, library, packs, logs, calibration); precedence for that directory is
  flag, then config, then OS default. Changing it requires a restart (PRV-004).
- `restartRequired` is true when `server` (except `server.pin`) or `dataDir` changed.
- **Default config** (PRV-001): one device `this-computer`, one Ollama provider at
  `http://localhost:11434`, no model profiles, every role `null`.
- **Load** = parse with `MachineConfigSchema`, then cross-reference checks (PRV-002);
  report every issue with its JSON path. A config that fails to load is not replaced:
  the server starts with the error shown in settings.
- **Save** validates first, then writes a temp file in the same folder and renames it
  over the old one (the exception CONV-085 allows). Validation issues use
  `SemanticIssue` paths (CON-091).
- **Secrets.** `resolveSecret` reads `{ env }` from the environment or returns `{ value }`.
  `redact(config)` replaces every inline secret value and `server.pin.hash` with
  `SECRET_PLACEHOLDER`; `mergeSecrets(incoming, stored)` puts stored values back where
  the placeholder appears, and reports a placeholder with nothing stored as an issue.
  Never log a config object (CONV-072).

## Acceptance

- [ ] PRV-001: starting with an empty directory writes the default config, which loads.
- [ ] PRV-002: a config with three broken references reports all three with paths.
- [ ] CON-111: a property-style test over configs with random inline secrets shows no secret string ever appears in `JSON.stringify(redact(config))`, and that `mergeSecrets(redact(c), c)` returns `c`.
- [ ] PRV-003: a crash simulated between temp write and rename leaves the old file intact.
- [ ] ARCH-030: the resolver returns the right path for `win32`, `darwin`, and `linux`.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
