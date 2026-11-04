# P1-T01: Scaffold the repository and tooling

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] `pnpm install && pnpm check` passes on a clean clone, on both operating systems in CI.
- [ ] `scripts/lint-rules.test.ts` proves each boundary and restriction listed in the design notes fires, with test names citing ARCH-007, ARCH-010, ARCH-020, ARCH-021, CONV-060, CONV-070, and CONV-087.
- [ ] `pnpm --filter @mythos/client build` produces a static build.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
