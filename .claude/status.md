# Status: Mythos
Updated: 2026-11-04 · Through: 3d68f76 · Branch: main

## Current focus
Phase 1 (Foundation): 0 of 25 tasks done. P1-T01, the scaffold, is open on `p1-t01-scaffold` and
not yet merged; nothing blocks it. P1-T02 (contracts, fixtures, the spec and docs checks) follows it.
After T02, the core ports (T03), the config module (T06), the events module (T09), and the client
foundation (T21) can run in parallel.

## Recent changes
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
- `main` has commits not on `origin/main` (99c85b0): the pnpm 12 amendment and the status commits.
  Not pushed; waiting for Mike's say-so.
- Branch `p1-t01-scaffold` is not merged.
- nvm's default Node on this machine is 26.7.0, below ARCH-002's 26.11.0, so `pnpm install` refuses
  the workspace in a new shell. Node 26.13.0 is installed but has no Corepack yet (Node 26 no
  longer bundles it): under 26.13, run `npm install -g corepack` and `corepack enable`, then
  `nvm alias default 26`.
