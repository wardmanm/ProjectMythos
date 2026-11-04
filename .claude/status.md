# Status: Mythos
Updated: 2026-11-04 · Through: fecee71 · Branch: main

## Current focus
Phase 1 (Foundation): 1 of 25 tasks done. P1-T01, the scaffold, merged in PR #26. Ready to start:
P1-T02 (contracts, fixtures, the spec and docs checks). No branch open. After T02, the core
foundations (T03), the config module (T06), the events module (T09), and the client foundation (T21)
can run in parallel.

## Recent changes
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
- 2026-11-04: Mike's decision: merged the tasks cut small for Qwen. P1-T11 now covers both local adapters
  (Ollama and OpenAI-compatible) and P1-T23 the play screen with its inspector. The tasks after them are
  renumbered, so phase 1 has 25 tasks: the old T13 to T27 are now T12 to T25. T03 and T04 stay separate.
- 2026-11-02: Mike's decision: stay on TypeScript 6.0 until typescript-eslint supports 7. ADR-015 already
  says this, so nothing changes.
- 2026-11-02: Mike's decisions: development is Mike and Claude only, and the docs model goes in as
  proposed (ADR-017: spec as the only description, rulings and pending decisions, `pnpm trace`, the docs
  check, this log, and the `status` and `docs` skills). Qwen stays as the game's local model.
- 2026-10-13: Handoff delivered: the spec (00-overview to 15-media), 16 ADRs, the phase 1 plan and 27
  tasks, the fixtures, and the reference code with its checks.

## Pending decisions
- None.

## Loose ends
- The root `pnpm trace` and the spec and docs checks in `pnpm check` arrive with P1-T02. Until then, run
  `pnpm --filter @mythos/spec-reference trace` and `... check`. On macOS a bare `pnpm trace` runs the
  system's `/usr/bin/trace` instead.
