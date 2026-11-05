# Status: Mythos
Updated: 2026-11-05 · Through: 129bc99 · Branch: main

## Current focus
Phase 1 (Foundation): 5 of 25 tasks done. P1-T04 merged in PR #30. Ready to start, and independent
of each other: P1-T05 (world-state fold and commit validation), P1-T07 (server storage module),
P1-T08 (server content module), P1-T09 (server events module), P1-T10 (provider types, mock adapter,
token estimation), P1-T16 (auth module), and P1-T21 (client foundation). P1-T07, P1-T09, and P1-T10
head the longest chain (P1-T13 job queue, P1-T14, P1-T18 context, P1-T19, P1-T20); P1-T05 and P1-T08
lead to campaign creation (P1-T17). No branch open.

## Recent changes
- 2026-11-05: P1-T04 merged (#30): `packages/core` has the hard floor and content wording,
  ruleset checks, gear checks and appearance, display names, and prompt budgets. Mike's
  decisions: CTX-030's margin is 10% of `contextWindow − maxOutputTokens`; CTX-031's caps
  apply to trimmable tiers only; `core`'s files go in folders by spec document (`rules/`,
  `state/`, `knowledge/`, `prompts/`, `time/`), so P1-T05 and P1-T17 now name `state/`.
  Rulings: four reference bugs fixed; new `appendFloorToTask` and `inputBudget`; the hard
  limit weighs the holder's load after the move, contents included (11-gear Decisions).
- 2026-11-04: P1-T03 merged (#29): `packages/core` has `cmp`, calendar math (`toDate`, `fromDate`, leap
  rules, festivals, weekdays), date and duration display, and theme contrast checks; all 518 truth-table
  dates and all six built-in themes pass. Rulings: the reference `cmp` compared UTF-16 code units, so it
  and the port now compare code points (spec fix; 02-conventions Trap); `packages/core` has Node's types
  for its tests, and lint bans Node globals in core source (02-conventions Decisions);
  `calendar-display.ts` split out to keep `calendar.ts` under 300 lines.
- 2026-11-04: P1-T06 merged (#28): the config module finds the data directory (flag, then config, then
  OS default), writes the default machine config, checks it with every issue at a dotted path, saves
  atomically into a store whose edits apply at once, and keeps inline keys and the PIN hash out of
  responses. Mike's decision: a saved placeholder takes the key stored for the provider with the same
  `id` (CON-111 reworded). Rulings, in 05-providers' Decisions: `restartRequired` compares with the
  running config; PRV-002 also checks unique IDs and media profile kinds; the default file is minimal.
  05-providers Open: `headers` are not secrets.
- 2026-11-04: P1-T02 merged (#27): `packages/contracts/src/`, `content-library/`, and
  `content-packs/reference/` are byte-for-byte copies of the spec, and `scripts/check-spec.ts` fails
  `pnpm check` on any difference (OVR-030, OVR-033). `pnpm check` now also runs `spec/reference`'s check
  (drift and docs), and `pnpm trace` works from the root. Rulings: an unused local, `stat`, removed from
  `makeExtractionSchemas` (spec fix; 03-contracts Trap: reference contracts are linted only as
  copies); the check's tests run it as a child process; a missing source folder fails the check;
  `tsx` 4.23.15 at the root.
- 2026-11-04: Mike's decision: he signs off each feature before a release (ADR-019, CONV-137 to
  CONV-140). At `/docs close`, Claude asks the phase plan's Try/Expect checks one at a time, on macOS and
  Windows, and records each answer in its Sign-off table. A failure is an issue labeled `bug` and
  `sign-off`, with the board's Priority: P0 blocks the release, P1 is high but doesn't block, P2 is
  deferred. Phase 1's checklist is now nine such checks.
- 2026-11-04: P1-T01 merged (#26): the pnpm 12 workspace with the four packages and `spec/reference`,
  strict TypeScript, Prettier, Vitest, ESLint with eslint-plugin-boundaries v7 (16 lint-rule tests),
  and CI on Windows and macOS. Rulings: `engineStrict` goes in `pnpm-workspace.yaml`, with no
  `.npmrc` (spec fix, ARCH-001 Trap); a root `tsconfig.json` for `scripts/`; `check` also runs
  `prettier --check`; `@mythos/*` imports are checked by package name; versions pinned exactly;
  `build` is real, while `dev` and `start` wait for P1-T20; lint also covers `Intl.Collator`, every
  `new Date` in core, and CONV-002 to CONV-005; CI runs on PRs and pushes to `main` only. Mike's
  decision: `spec/reference` keeps its own `pnpm-lock.yaml` (01-architecture Decisions).
- 2026-11-04: Mike's decision: GitHub mirrors the tasks (ADR-018, CONV-136, CONV-137). Each task has an
  issue on the Project Mythos board, in its phase's milestone (all ten exist), and its PR says
  `Closes #N`. Each phase ends in a `v0.N.0` release. Issues #1 to #25 are P1-T01 to P1-T25.
- 2026-11-04: Mike's decision: pin pnpm 12 (`pnpm@12.16.1`) instead of 10. The root
  `pnpm-workspace.yaml` approves esbuild's build with `allowBuilds`, since pnpm 11 and later ignore
  `pnpm.onlyBuiltDependencies` in `package.json`. Recorded in 01-architecture's Decisions table; the
  P1-T01 design notes, `spec/reference/package.json`, and its README follow it.

## Pending decisions
- None.

## Loose ends
- None.
