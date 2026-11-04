# Status: Mythos
Updated: 2026-11-04 · Through: — (written in the handoff, before the repository exists) · Branch: main

## Current focus
Phase 1 (Foundation) has not started. Next: create the repository from the handoff, then P1-T01, the
scaffold, and P1-T02, which installs the contracts and fixtures and turns on the spec and docs checks.
After T02, the core ports (T03), the config module (T06), the events module (T09), and the client
foundation (T21) can run in parallel. No branch open.

## Recent changes
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
- The repository does not exist yet. Put `CLAUDE.md`, `.claude/`, and `spec/` from the handoff at its
  root, commit, set `Through:` above to that commit, then start P1-T01.
