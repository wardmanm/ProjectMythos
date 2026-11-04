# Status: Mythos
Updated: 2026-11-04 · Through: f3d6fe6 · Branch: main

## Current focus
Phase 1 (Foundation) has not started: 0 of 25 tasks done. `pnpm trace` lists P1-T01, the scaffold,
as the only task ready to start. P1-T02 (contracts, fixtures, the spec and docs checks) follows it.
After T02, the core ports (T03), the config module (T06), the events module (T09), and the client
foundation (T21) can run in parallel. No branch open.

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
- `main` is ahead of `origin/main` (99c85b0) by the pnpm 12 amendment and two status commits. Not
  pushed; waiting for Mike's say-so.
- `spec/reference/pnpm-workspace.yaml` is untracked, left by the standalone install with a placeholder
  `allowBuilds` entry. Delete it before P1-T01's root `pnpm-workspace.yaml` lands, or pnpm treats
  `spec/reference` as a workspace of its own (`spec/reference/README.md`).
- This machine runs Node 26.7.0. ARCH-002 needs 26.11.0 or later, and P1-T01's `engine-strict=true`
  will refuse the install until Node is upgraded.
