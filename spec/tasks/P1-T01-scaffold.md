# P1-T01: Scaffold the repository and tooling

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | — |
| **Branch** | `p1-t01-scaffold` |

## Goal

Create the empty monorepo every later task builds in: the four workspace packages,
TypeScript, lint with enforced module boundaries, formatting, tests, and CI on Windows
and macOS. No application code yet.

## Read

- `spec/00-overview.md` and `spec/glossary.md`
- `spec/01-architecture.md` §1, §2, §3 (the two module tables), §7
- `spec/02-conventions.md`, all of it
- `spec/decisions/ADR-002-monorepo-shape.md`, `ADR-015-typescript-and-runtime.md`

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-001, ARCH-002, ARCH-003, ARCH-004, ARCH-005, ARCH-006, ARCH-007, ARCH-010, ARCH-020, ARCH-021, CONV-001, CONV-002, CONV-003, CONV-004, CONV-005, CONV-015, CONV-060, CONV-070, CONV-081, CONV-083, CONV-086, CONV-110, CONV-120, CONV-121, CONV-122

## Outputs

- Root: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.gitattributes`, `.gitignore`, `.editorconfig`, `.prettierrc.json`, `.prettierignore`, `eslint.config.js`, `tsconfig.base.json`, `vitest.config.ts`, `README.md`
- `.github/workflows/check.yml`
- `packages/contracts/`, `packages/core/`: `package.json`, `tsconfig.json`, `README.md`, `src/index.ts` (placeholder); contracts also `src/content/index.ts`
- `apps/server/`: `package.json`, `tsconfig.json`, `README.md`, `src/main.ts` (placeholder), `src/modules/` (empty)
- `apps/client/`: `package.json`, `tsconfig.json`, `README.md`, `vite.config.ts`, `index.html`, `src/main.tsx` rendering the word "Mythos"
- `scripts/README.md`, `scripts/lint-rules.test.ts`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133

## Design notes

- **Versions.** Node `>=26.11.0 <27` in `engines`, `26` in `.nvmrc`, `engineStrict: true`
  in the root `pnpm-workspace.yaml` (pnpm 11 and later read only auth, registry, and
  network settings from `.npmrc`, so there is no `.npmrc`). Pin pnpm with
  `"packageManager": "pnpm@12.16.1"`. TypeScript `~6.0.3` (ADR-015). Prettier exactly
  `3.9.9`.
- **Prettier config** is `{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }`:
  the spec's contracts are already formatted this way. `.prettierignore` lists `spec/`,
  `content-library/`, `content-packs/`, and `packages/contracts/src/`, because those
  are byte-for-byte copies of spec files (OVR-030, OVR-033).
- **`pnpm-workspace.yaml`** lists `apps/*`, `packages/*`, and `spec/reference`, and sets
  `allowBuilds: { esbuild: true }`. The setting must be at the root: pnpm reads settings
  only from the workspace root's `pnpm-workspace.yaml`, and pnpm 11 and later ignore
  `pnpm.onlyBuiltDependencies` in a `package.json`. Without it, `pnpm install` exits
  with `ERR_PNPM_IGNORED_BUILDS` for esbuild's build script.
- **Not tested.** ARCH-001 to ARCH-006 are met by the scaffold's shape rather than by a
  test: give each an `ARCH-001: what shows it` entry under **Not tested** (CONV-135).
  The docs check holds this task to that once P1-T02 turns it on.
- **Root Vitest** excludes `spec/**`: the reference package runs its own suite through
  its `check` script (P1-T02), with aliases only it has.
- **TypeScript.** `tsconfig.base.json` has CONV-001's flags, `module: ESNext`,
  `moduleResolution: Bundler`, `target: ES2023`, `noEmit: true`. Each package extends
  it. Packages export TypeScript source (ARCH-005): `"exports": { ".": "./src/index.ts" }`,
  plus `"./content": "./src/content/index.ts"` for contracts.
- **Lint.** `typescript-eslint` strict type-checked configs and `eslint-plugin-boundaries`:
  - the dependency table in ARCH §2 between `contracts`, `core`, `server`, `client`;
  - server modules under `apps/server/src/modules/<name>/` import each other only
    through `index.ts` (ARCH-020) and only as ARCH-021's table allows; `app.ts` and
    `main.ts` may import any module's `index.ts`; files in `apps/server/src/cli/`
    import only `app.ts` (ARCH-022);
  - in `packages/core/src` (tests excepted): no `node:*` imports, and no `Date.now()`,
    `new Date()`, or `Math.random()` (`no-restricted-syntax`), per CONV-060;
  - `no-console` everywhere except `scripts/` and `apps/server/src/cli/` (CONV-070);
  - `no-restricted-syntax` for `localeCompare` outside `apps/client` (CONV-087);
  - files in `/scripts` import no `apps/*` code (ARCH-007).
  Lint ignores `spec/`.
- **`scripts/lint-rules.test.ts`** runs ESLint's Node API on small code strings with
  fake file paths and asserts that each rule above fires, so the boundaries are
  themselves tested.
- **Root scripts.** `check` runs typecheck in every package, lint, and all tests
  (`vitest run --passWithNoTests` until tests exist). `dev`, `build`, and `start` may
  be placeholders that exit with a message naming the task that implements them
  (P1-T20). No shell syntax beyond `&&` (CONV-081).
- **CI** runs `pnpm install --frozen-lockfile` and `pnpm check` on `windows-latest` and
  `macos-latest`, with Node from `.nvmrc`.
- `.gitattributes`: `* text=auto eol=lf`, and binary for fonts and images.
- `.gitignore` covers `node_modules/` and build output, and ignores `.claude/*` except
  `!.claude/skills/` and `!.claude/status.md`: the skills and the status log are
  tracked (ADR-017). `CLAUDE.md` and `.claude/` arrive with the spec; leave them as they are.

## Acceptance

- [x] `pnpm install && pnpm check` passes on a clean clone, on both operating systems in CI.
- [x] `scripts/lint-rules.test.ts` proves each boundary and restriction listed in the design notes fires, with test names citing ARCH-007, ARCH-010, ARCH-020, ARCH-021, CONV-060, CONV-070, and CONV-087.
- [x] `pnpm --filter @mythos/client build` produces a static build.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - The pnpm 12 workspace: `apps/server`, `apps/client`, `packages/contracts`,
    `packages/core`, and `spec/reference`.
  - Strict TypeScript from `tsconfig.base.json`, Prettier, and Vitest.
  - ESLint with typescript-eslint's strict type-checked rules and eslint-plugin-boundaries
    v7, whose single `boundaries/dependencies` rule holds the ARCH §2 package table and
    the ARCH-020 to ARCH-022 module rules.
  - `scripts/lint-rules.test.ts`, 16 tests, each proving a rule fires and stays quiet
    where allowed.
  - CI for Windows and macOS. The client builds to `apps/client/dist/`.
  - Checked on macOS from a clean install with `pnpm install --frozen-lockfile`:
    - `pnpm install` ran esbuild's build with no ignored builds;
    - on Node 26.7.0 it fails with `ERR_PNPM_UNSUPPORTED_ENGINE`;
    - deliberate violations in the real tree failed lint: `Math.random()` in core, an
      import of another module's internal file, and `@mythos/core` in the client;
    - `pnpm --filter @mythos/spec-reference check` passes, docs check included.
  - CI passes on `windows-latest` and `macos-latest` (PR #26, run 41861480691). During
    a GitHub Actions outage, GitHub cancelled the first macOS attempts before they ran;
    the re-run passed.
  - `pnpm check`: `Tests  16 passed (16)`.
- **Rulings:**
  - **ARCH-001, spec fix** (`P1-T01: spec: engine-strict moves to pnpm-workspace.yaml`).
    `engineStrict: true` goes in the root `pnpm-workspace.yaml`, and `.npmrc` leaves the
    Outputs. pnpm 11 and later read only auth, registry, and network settings from
    `.npmrc`. Checked with pnpm 12.16.1: `engine-strict=true` in `.npmrc` let a dependency
    with `engines.node >=99` install, while `engineStrict: true` in the workspace file
    refused it. 01-architecture gains a Traps entry for it.
  - **Root `tsconfig.json`** is an extra file (CONV-132). `scripts/` and
    `vitest.config.ts` need a TS project for `typecheck` and for type-aware lint.
  - **`check` also runs `prettier --check .`,** so CONV-120 is enforced. `.prettierignore`
    also lists `pnpm-lock.yaml`, `CLAUDE.md`, and `.claude/`. Recorded in 02-conventions'
    Decisions.
  - **`@mythos/*` imports are checked by package name,** and Node built-ins in core are
    blocked by their `core` origin in the same boundaries rule, rather than by
    `no-restricted-imports`. Recorded in 02-conventions' Decisions.
  - **Versions are pinned exactly** except TypeScript `~6.0.3`. vitest 5.0.3,
    @types/node 26.6.4, and vite 8.3.4 match the versions `spec/reference` uses. Recorded
    in 02-conventions' Decisions.
  - **`build` runs the client build now** (ARCH-006). `dev` and `start` print a message
    naming P1-T20 and exit 1.
  - **Lint goes past the design notes' list,** since the requirements name more:
    - CONV-087 also covers `Intl.Collator`;
    - CONV-060 bans every `new Date` in core source, not only `new Date()`, because core
      works in game time;
    - CONV-002 to CONV-005 are enforced and tested.
  - **Test naming.** The package-table tests cite CONV-121, which requires lint to
    enforce that table, since the table has no ID of its own. The cli test cites ARCH-022.
  - **`apps/server/src/modules/.gitkeep`** keeps the empty modules folder in git.
  - **CI runs on pull requests and on pushes to `main`,** not on every push. Otherwise a
    PR branch is checked twice. Every change reaches `main` through a PR (CONV-136), so
    CONV-086 still holds.
- **Pending decisions:**
  - **Unused reference lockfile** (raised 2026-11-04, P1-T01). Now that `spec/reference`
    is a workspace member, the root `pnpm-lock.yaml` governs it, and
    `spec/reference/pnpm-lock.yaml` goes unused inside the repository.
    - Options: keep it, so the reference still installs its pinned versions when copied
      out on its own / delete it in P1-T02.
    - Claude's suggestion: keep it.
    - Does not block.
    - Decided 2026-11-04: keep it. Recorded in 01-architecture's Decisions.
- **Not tested:**
  - ARCH-001: `pnpm-workspace.yaml` and `"packageManager": "pnpm@12.16.1"` in the root
    `package.json`.
  - ARCH-002: `.nvmrc` holds `26` and `engines.node` is `>=26.11.0 <27`. pnpm refuses
    the install on Node 26.7.0.
  - ARCH-003: the workspace holds only the four packages ARCH-004 names, plus
    `spec/reference` (ADR-016).
  - ARCH-004: each `package.json` names its package. Dependencies use `workspace:*`,
    contracts exports `./content`, and `pnpm-workspace.yaml` lists `spec/reference`.
  - ARCH-005: `exports` in contracts and core point at `./src/*.ts`, and each package's
    `typecheck` runs `tsc` with `noEmit` from the base config.
  - ARCH-006: the root `package.json` scripts. `build` builds the client, `check` follows
    CONV-122, and `dev` and `start` are placeholders until P1-T20.
- **Dependencies:**
  - Tooling, all on CONV-091's list: `eslint` 10.14.0, `typescript-eslint` 8.72.1,
    `eslint-plugin-boundaries` 7.4.1, `prettier` 3.9.9, `typescript` ~6.0.3, `vitest`
    5.0.3, `@types/node` 26.6.4, `vite` 8.3.4, `@vitejs/plugin-react` 6.2.1, and
    `@types/react` and `@types/react-dom` 19.3.0.
  - Runtime, on the Client list: `react` and `react-dom` 19.3.1.
  - None outside the approved list.
