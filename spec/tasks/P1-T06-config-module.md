# P1-T06: Server config module

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
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

- [x] PRV-001: starting with an empty directory writes the default config, which loads.
- [x] PRV-002: a config with three broken references reports all three with paths.
- [x] CON-111: a property-style test over configs with random inline secrets shows no secret string ever appears in `JSON.stringify(redact(config))`, and that `mergeSecrets(redact(c), c)` returns `c`.
- [x] PRV-003: a crash simulated between temp write and rename leaves the old file intact.
- [x] ARCH-030: the resolver returns the right path for `win32`, `darwin`, and `linux`.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/config/`: `data-dir.ts`, `machine-config.ts`,
    `cross-references.ts`, `secrets.ts`, `index.ts`, and `README.md`, with 34 tests
    in four files. The module imports no other module and has no logger.
  - `openConfig` returns a `ConfigStore` (`configPath`, `dataDir`, `current()`,
    `save()`) for the composition root (P1-T20). P1-T16's `setPin` saves through
    `store.save`.
  - Acceptance, by test:
    - PRV-001: `an empty folder gets the default config, which loads`;
    - PRV-002: `three broken references are all reported, each with its path`;
    - CON-111: the property test over 200 seeded configs (264 inline secrets), with a
      guard against a vacuous pass;
    - PRV-003: `a crash between the temp write and the rename leaves the old file
      intact`;
    - ARCH-030: the `win32`, `darwin`, and `linux` resolver tests.
  - Verified, then reverted: with `redact` no longer hiding the PIN hash, the CON-111
    property test and a PRV-005 test both fail.
  - `pnpm check` passes. The workspace has `Tests  59 passed (59)` and `spec/reference`
    `Tests  267 passed (267)`, and it ends with `Docs check passed: 834 requirements, 25
    tasks (3 done), 19 ADRs, 75 markdown files, 71 citations in code.`
- **Rulings:**
  - **CON-111, owner's decision** (`P1-T06: spec: owner: stored secrets follow the
    provider id`). A placeholder takes the key stored for the provider with the same
    `id`, not the same index, so reordering or deleting providers never moves a key.
    Recorded in 03-contracts' Decisions.
  - **PRV-002 checks more than it lists**: unique IDs in each list, media picks of the
    right kind (MED-002), and a `profileId` for server speech input. Recorded in
    05-providers' Decisions.
  - **PRV-004: `restartRequired` compares with the config the server started with**,
    so the notice stays until a restart. Recorded in 05-providers' Decisions.
  - **PRV-001: the default file is minimal**, with every role written as `null`; saves
    write the complete config. Recorded in 05-providers' Decisions.
  - **A failed save reports secret and schema issues together** (CON-091), and nothing
    is written.
  - **No logger in the module**: `openConfig` reports `created` for the caller to log,
    so a config object can't reach a log (CONV-072).
  - **Relative paths**: a relative `--data-dir` resolves against the working folder,
    and a relative `dataDir` against the config's folder.
  - **On Windows with `APPDATA` unset**, the default is `<home>\AppData\Roaming\Mythos`.
  - **Extra file** (CONV-132): `apps/server/package.json` gains `zod` 4.6.5, for
    `z.infer` of contract schemas that export no type. `apps/server/src/modules/.gitkeep`
    is gone now that the folder has a module.
  - **Open, 05-providers**: `headers` on an `openai-compatible` provider are not treated
    as secrets.
  - **Trap, 02-conventions**: asymmetric matchers such as `expect.any(String)` are
    `any` under strict lint.
- **Pending decisions:** None.
- **Not tested:** None. Every behavioral requirement has a test named by its ID; CONV-072,
  CONV-080, and CONV-085 are met by the code and `pnpm check`.
- **Dependencies:**
  - `zod` 4.6.5 in `apps/server`, on CONV-091's list.
