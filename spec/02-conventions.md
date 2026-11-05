---
doc: 02-conventions
title: Mythos — Conventions
status: draft
schemaVersion: 1
requirementPrefix: CONV
---

# Conventions

> **For Claude:** these rules apply to every line of code in the repository. The owner must
> be able to read and change any file without an agent. When a rule here conflicts with
> a habit or a common pattern, this document wins.

## 1. Guiding rule

Write the most obvious code that satisfies the requirement. Prefer repetition over a
premature abstraction, a plain function over a class, a `switch` over a lookup of
function pointers, and an explicit parameter over hidden context. If a reviewer has to
ask "how does this work?", rewrite it.

## 2. TypeScript

- **CONV-001** `strict: true` plus `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- **CONV-002** No `any`. Use `unknown` and narrow it with a Zod schema or a type guard.
- **CONV-003** No non-null assertions (`!`) outside tests.
- **CONV-004** No TypeScript `enum`. Use string literal unions, derived from a Zod
  schema or an `as const` array.
- **CONV-005** No default exports, except where a tool requires them (e.g. Vite config).
- **CONV-006** Types for data are inferred from Zod schemas (`z.infer`), never written
  twice.
- **CONV-007** Prefer functions and plain objects. Classes are allowed only for stateful
  adapters that implement an interface (e.g. a provider adapter). No inheritance
  hierarchies deeper than one level.
- **CONV-008** No decorators, no reflection, no runtime metaprogramming, no
  dependency-injection libraries.

## 3. Naming and files

- **CONV-010** Use glossary terms exactly in identifiers, file names, UI text, and
  comments (`observation`, not `memory` or `fact`).
- **CONV-011** Files and folders: `kebab-case`. Types and React components:
  `PascalCase`. Functions and variables: `camelCase`. Constants: `camelCase` unless
  they are true compile-time constants shared widely (`UPPER_SNAKE_CASE`).
- **CONV-012** One primary export per file where practical; the file is named after it.
- **CONV-013** Tests sit next to the code: `dice-pool.ts` and `dice-pool.test.ts`.
- **CONV-014** Size limits. Files SHOULD stay under 300 lines and MUST NOT exceed 500
  without a comment at the top explaining why. Functions SHOULD stay under 50 lines.
- **CONV-015** No barrel files except each module's single public `index.ts`.

## 4. Comments and documentation

- **CONV-020** Comments explain *why*, never *what*.
- **CONV-021** Code implementing a requirement cites it: `// Implements RUL-014.`
- **CONV-022** Every exported function in a module's public API has a one- to
  three-line JSDoc summary.
- **CONV-023** Every module folder has a short `README.md`: purpose, public API, and
  which spec documents govern it.
- **CONV-024** `TODO` comments MUST include a reason and a reference:
  `// TODO(spec MEM-031): ranking weights are placeholders until tuned in phase 4.`

## 5. Validation and boundaries

- **CONV-030** All data entering the system is parsed with a Zod schema at the boundary:
  HTTP bodies, query params, files on disk, JSON columns read from SQLite, SSE payloads
  on the client, and all model output. Inside the boundary, types are trusted.
- **CONV-031** Parse, don't validate: boundary functions return the parsed value, not a
  boolean.
- **CONV-032** Model output is untrusted input. It is never executed, never used as a
  file path, and never written to the database without passing schema and semantic
  validation.

## 6. Errors

- **CONV-040** Expected failures return a `Result<T, E>` value (a small helper in
  `contracts`; no library). Examples: validation failures, malformed model output, an
  illegal state change, a provider timeout.
- **CONV-041** Unexpected failures (programmer errors, corrupted invariants) throw.
  They are caught once at the top of each HTTP request and each job, logged, and
  reported as `internal_error`.
- **CONV-042** Error types carry a stable `code` from an enumerated list in `contracts`
  and a human-readable message. Never branch on message text.
- **CONV-043** Never swallow an error. If a catch block does not rethrow or return a
  `Result`, it must log and explain why in a comment.

## 7. Storage

- **CONV-050** SQL is written by hand in repository files inside the `storage` module
  (and module-specific repository files it exposes). No ORM, no query builder.
- **CONV-051** Every row read from SQLite is parsed with a Zod row schema before use.
- **CONV-052** Migrations are numbered `.sql` files (`0001-initial.sql`, …) run by a
  small in-repo runner. Applied migrations are never edited.
- **CONV-053** IDs: runtime-created records use `crypto.randomUUID()`. Content-authored
  entities use human-readable slugs (e.g. `npc.varek`), unique within a pack.
- **CONV-054** Ordering never relies on IDs or timestamps; use explicit sequence
  columns.
- **CONV-055** Only `apps/server/src/modules/storage/sqlite.ts` imports `node:sqlite`.
  It wraps the driver in a small interface (open, close, exec, prepared statements,
  and `transaction(fn)` using `BEGIN IMMEDIATE`), and the rest of the code uses that
  wrapper, so the driver can be replaced in one file (ADR-012).

## 8. Purity, time, and randomness

- **CONV-060** `packages/core` never calls `Date.now()`, `new Date()`, `Math.random()`,
  or any IO. Time and randomness are parameters.
- **CONV-061** The server obtains wall time through an injected `TimeSource` (from
  `@mythos/contracts`, read as `timeSource.now()`) and randomness through an injected
  `Rng`, both created in the composition root, so tests can fix them.
- **CONV-062** Dice rolls record the RNG seed or raw die values in their commit so any
  result can be audited and replayed exactly.

## 9. Logging

- **CONV-070** Use the Fastify logger (pino) through the server's logger dependency.
  No `console.log` in committed code outside `/scripts` and the server's command-line
  tools in `apps/server/src/cli/`, whose output is for a person at a terminal.
- **CONV-071** Log structured fields, not interpolated strings:
  `log.info({ campaignId, turnId }, 'turn committed')`.
- **CONV-072** Never log PIN values, session tokens, or API keys. Prompt and output
  content goes to model call records, not logs.

## 10. Cross-platform (Windows and macOS)

- **CONV-080** Build every path with `node:path` (`path.join`, `path.resolve`). Never
  concatenate with `/` or `\`.
- **CONV-081** No shell scripts and no shell-specific syntax in `package.json` scripts
  (no `rm -rf`, `&&` chains with env vars, `export`, globs relying on the shell).
  Anything nontrivial is a Node script in `/scripts`.
- **CONV-082** Treat file names as case-insensitive but always reference them with
  their exact casing.
- **CONV-083** `.gitattributes` normalizes text files to LF. Code MUST NOT assume a
  line ending when reading user-provided files; normalize on read.
- **CONV-084** The project has no native dependencies. Adding one requires an ADR
  confirming prebuilt binaries for `win32-x64` and `darwin-arm64` on the pinned Node
  version (ADR-012).
- **CONV-085** Temporary files go in `os.tmpdir()`; application data goes in the
  configured data directory. Nothing is written next to the source code at runtime.
  The one exception is the temporary file of an atomic replace, which sits beside its
  target so the rename stays on one volume (PRV-003).
- **CONV-086** CI runs typecheck, lint, and tests on both `windows-latest` and
  `macos-latest` for every change.
- **CONV-087** Never use `localeCompare` or `Intl.Collator` for ordering that reaches
  stored data, prompts, or tests: their results depend on the machine's locale, so
  Windows and macOS can disagree. Compare strings by code point with the `cmp` helper in
  `core`. Locale-aware sorting is for display-only lists in the client.

## 11. Dependencies

- **CONV-090** A runtime dependency outside CONV-091's list is a pending decision with
  a Proposed ADR (OVR-036) that says what it does, why the standard library or an
  approved dependency is insufficient, and its maintenance status. It is added to the
  list once the owner accepts the ADR.
- **CONV-091** Approved baseline dependencies:

| Area | Packages |
|---|---|
| Shared | `zod` |
| Server | `fastify`, `@fastify/static`, `@fastify/cookie`, `handlebars`, `jsonrepair`, `tsx` (runtime, ADR-015). SQLite is Node's built-in `node:sqlite` (ADR-012) |
| Client | `react`, `react-dom`, `react-router`, `@tanstack/react-query`, `zustand`, `tailwindcss`, shadcn/ui and the packages its generated components import (Radix primitives, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`), `@tailwindcss/vite`, the `@fontsource` packages for the faces in `BUNDLED_FONTS` (UI-034) |
| Tooling | `typescript` (pinned `~6.0`, ADR-015), `@types/node`, `vite`, `@vitejs/plugin-react`, `vitest`, `eslint`, `typescript-eslint`, `eslint-plugin-boundaries`, `prettier`, `@types/react`, `@types/react-dom`, `@playwright/test`, `@axe-core/playwright` (UI-131), `jsdom`, `@testing-library/react`, `@testing-library/user-event` (client component tests) |

## 12. Client

- **CONV-100** Components are small and presentational where possible; data loading
  lives in hooks from `api/`.
- **CONV-101** Style with Tailwind utility classes. No CSS-in-JS. Global CSS only for
  theme tokens.
- **CONV-102** Files in `components/ui/` are generated by shadcn/ui. Edit them
  deliberately and note the change at the top of the file.
- **CONV-103** Every interactive element is reachable by keyboard and has a touch
  target of at least 44×44 CSS pixels.

## 13. Testing

- **CONV-110** Test runner: Vitest, for server, core, and client.
- **CONV-111** Test names start with the requirement ID they verify, or several
  separated by commas, then a colon: `it('RUL-014: two sixes produce a critical', …)`.
- **CONV-112** `packages/core` aims for complete branch coverage; it is pure and cheap
  to test.
- **CONV-113** No test touches the network or a real model. Model calls use the **mock
  provider**, which replays recorded fixtures or returns scripted outputs.
- **CONV-114** A script records new fixtures from a real provider. Fixtures are
  committed and reviewed like code.
- **CONV-115** Prompt templates have snapshot tests of their rendered output for a
  fixed fixture campaign, so prompt changes show up in review as diffs.
- **CONV-116** Storage tests use a fresh SQLite database in `os.tmpdir()` per test file.

## 14. Formatting and linting

- **CONV-120** Prettier formats everything; its output is never argued with.
- **CONV-121** ESLint with `typescript-eslint` strict rules and
  `eslint-plugin-boundaries` enforcing ARCH-010 through ARCH-021.
- **CONV-122** `pnpm check` runs typecheck, lint, and tests across the workspace, the
  fixture-copy check (OVR-030), and `spec/reference`'s own check, which includes the
  drift check (OVR-033) and the docs check (OVR-038). It is the single command that
  defines "passing". Lint and Prettier ignore `spec/`.

## 15. Workflow for every task

- **CONV-130** One task per branch. Branch name: `pN-tNN-short-title`.
- **CONV-131** Commit messages start with the task ID: `P1-T03: add dice pool`.
- **CONV-132** Change the files the task lists under **Outputs**, plus its own Status
  and Completion notes. When another file must change for the task to work, change it
  and record it under **Rulings** with the reason. When that file is listed under **Do
  not touch**, or the change would widen the task's scope, raise it under **Pending
  decisions** instead.
- **CONV-133** In a task branch, the spec changes only to fix what the task found. A
  contradiction, ambiguity, or error with one reasonable answer is fixed in place
  (OVR-034) and recorded under **Rulings** with the requirement IDs. Anything that
  changes behavior, scope, or a recorded decision is raised under **Pending
  decisions** and waits for the owner. Spec changes go in their own commits, starting
  `P1-T09: spec:` in a task branch and `spec:` outside one (`spec: owner:` when it
  carries out the owner's decision), so `git log` on a document is its history.
- **CONV-134** Definition of done:
  1. `pnpm check` passes, including the docs check (OVR-038).
  2. Every requirement listed in the task is implemented, and each behavioral one has
     a test whose name starts with its ID or an `ID: reason` entry under **Not
     tested**.
  3. No runtime dependency outside CONV-091's list unless the owner has accepted its
     ADR (CONV-090).
  4. Module READMEs updated if a public API changed.
  5. Traps and decisions the task found are in the closing sections of the documents
     that govern them (OVR-035).
  6. Completion notes written (CONV-135), no pending decision blocks the task, and
     Status is `Done`.
- **CONV-135** Completion notes have five parts:
  - **Done:** what was built, and the final summary line of `pnpm check`;
  - **Rulings:** each call made without the owner, with the reason;
  - **Pending decisions:** questions for the owner, each with its options and whether
    it blocks the task (the status log carries them). When the owner decides one, it
    stays here, marked `Decided YYYY-MM-DD: the answer`;
  - **Not tested:** one entry per requirement with no test, written `RUL-014: the
    reason`;
  - **Dependencies:** any new one: a tooling one with its reason, and the ADR for a
    runtime one outside CONV-091's list.

  A part with nothing in it says "None".
- **CONV-136** Each task has one GitHub issue, opened when its task file is written.
  Its title is the task file's title (`P1-T01: Scaffold the repository and tooling`).
  It has the `task` label and its phase's milestone (`Phase 1: Foundation`), and it is
  on the owner's Project Mythos board. Its body links the task file and the issues it
  depends on. The task's pull request is titled the same, and its body starts with
  `Closes #N`, so the merge closes the issue and the board's workflows move its card.
  The issue mirrors the task file and is never edited to show progress (OVR-037,
  ADR-018).
- **CONV-137** Each phase ends in a release, once the owner has signed it off
  (CONV-139). At phase close, the root `package.json` version is set to `0.N.0` for
  phase N, and that commit on `main` is tagged `v0.N.0`. A GitHub release for the tag
  is published with the phase plan's **Retrospective** as its notes, followed by the
  phase's open P1 bugs as known issues, and the phase's milestone is closed (ADR-018,
  ADR-019).
- **CONV-138** Each phase plan has **Sign-off checks**, written from its deliverable
  when the plan is written: one check per feature, naming the deliverable item it
  checks, what to **Try**, and what to **Expect**. A task that changes what a feature
  does updates its check. Only the owner drops or rewords a check, and the plan records
  the reason.
- **CONV-139** The owner signs off a phase at its close. Claude first proposes a check
  for any user-visible feature the phase merged without one, and the owner approves the
  list. Claude then presents the checks one at a time, and the owner answers Pass,
  Fail, or Skip, once on macOS and once on Windows. Each answer goes into the plan's
  **Sign-off** table at once, with the commit tested. When `main` changes after a check
  has passed, the owner chooses which checks to run again. The phase is released only
  when no P0 bug is open in its milestone, no cell is empty or skipped, and every check
  has passed on both systems or failed with only P1 or P2 bugs (ADR-019).
- **CONV-140** A failed check becomes a GitHub issue labeled `bug` and `sign-off`, in
  the phase's milestone and on the board, with the board's **Priority** set: `P0`
  blocks the release, `P1` is high but does not block, and `P2` is deferred. Claude
  drafts it with the check, what happened against its Expect, the OS, and the commit;
  the owner confirms its title and Priority before it is posted. A P0 is fixed by a new
  task in the current phase, whose pull request also closes the bug, and its check is
  run again after the merge. An open P1 becomes a task at the start of the next phase's
  plan. A P2 stays on the board until a phase takes it on. The issue is the bug's own
  record, and the Sign-off table links it (ADR-019).

## Traps

- **ESLint rule options do not merge (CONV-121).** In `eslint.config.js`, a later config
  object that sets `no-restricted-syntax` for a file replaces the earlier list rather
  than adding to it. Each file group therefore lists every selector that applies to it;
  adding a restriction means adding it to each group.
- **Boundaries descriptor order (CONV-121, ARCH-020, ARCH-021).** A file takes the type
  of the first element descriptor it matches. The server's modules and cli must come
  before `apps/server/src`, which contains them. Otherwise every import inside the
  server counts as internal to one element, and none of it is checked.
- **A broken boundaries policy only warns (CONV-121).** eslint-plugin-boundaries prints
  an invalid policy, such as `allow: { to: [] }`, as a console warning and skips it,
  and lint still passes. After changing the policies, read lint's output and run
  `scripts/lint-rules.test.ts`.
- **Asymmetric matchers are `any` (CONV-002).** `expect.any(String)` and
  `expect.stringContaining(…)` return `any`, so an object literal holding one fails
  strict lint (`no-unsafe-assignment`). Parse the value with its schema, such as an
  error's `details` with `SemanticIssueSchema`, and compare its fields.
- **`<` on strings is not code-point order (CONV-087).** JavaScript compares strings by
  UTF-16 code unit, so a character beyond U+FFFF, such as an emoji, sorts before
  U+E000 to U+FFFF. That differs from code-point order and from SQLite's default
  `BINARY` collation. Sort with `cmp` from `core`, never with `<` or `localeCompare`.

## Decisions

| Question | Decision | Rejected and why | Decided by |
|---|---|---|---|
| Does `pnpm check` enforce Prettier (CONV-120, CONV-122)? | Yes: `check` runs `prettier --check .`. `.prettierignore` also lists `pnpm-lock.yaml`, `CLAUDE.md`, and `.claude/`, which pnpm writes or which arrive with the spec. | Leaving formatting to editors: nothing would enforce CONV-120. | Claude (ruling) |
| How does lint see `@mythos/*` imports (CONV-121)? | By package name: boundaries' default resolver does not read `exports`, so it classes them as external modules. Each policy names both the package and its folder, so a relative import across packages is caught too. Node built-ins in `core` are blocked the same way, by their `core` origin. | `eslint-import-resolver-typescript`: it brings a native resolver with its own build script, so a second `allowBuilds` entry. | Claude (ruling) |
| How are dependency versions written (CONV-091)? | Exact versions, except TypeScript `~6.0.3` (ADR-015). A tool that `spec/reference` also uses takes its version there, so the workspace holds one copy. | Ranges: the lockfile pins them anyway, but a range hides which version was reviewed. | Claude (ruling) |
| How do `core`'s tests read fixtures while `core` stays pure (CONV-060)? | `packages/core` has Node's types (`types: ["node"]`) so its tests can use `node:fs`, `node:path`, and `node:url`. Lint keeps Node out of core source: boundaries blocks Node built-ins, and `no-restricted-globals` blocks `process`, `Buffer`, `fetch`, `global`, `require`, and the timers. | `types: []` with fixtures imported as JSON modules: the tests could not list a folder, so "every theme in `content-library/themes/`" would need each theme named by hand. | Claude (ruling) |
| What is the injected wall-time dependency called (CONV-061)? | `TimeSource`, `{ now(): number }` in milliseconds since the Unix epoch, exported from `@mythos/contracts` beside `WallTime` so every server module can import it. | `Clock`: the glossary's Clock is the progress tracker, and contracts already exports a `Clock` type for it. A bare `now()` function: next to `Date.now()` it is unclear which one is meant. | owner |
| Which `node:sqlite` class does `sqlite.ts` import (CONV-055, ADR-012)? | `DatabaseSync`. `@types/node` 26.6.4 declares no `Database`, and at runtime the two names are the same class. The import moves to `Database` once the types declare it; only `sqlite.ts` changes. | `Database`, as ADR-012 first said: it does not typecheck. A hand-written declaration for it: a second copy of the driver's types to keep in step. | owner |
