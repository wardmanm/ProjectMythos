# Status: Mythos
Updated: 2026-11-05 · Through: 11bf8d2 · Branch: main

## Current focus
Phase 1 (Foundation): 12 of 25 tasks done. Seven tasks ran in parallel worktrees and merged as PRs
#31 to #37; the worktrees are removed. Ready to start: P1-T11 (Ollama and OpenAI-compatible
adapters), P1-T12 (Anthropic adapter), P1-T13 (job queue), and P1-T17 (campaign creation). P1-T13
and P1-T17 head the longest chain (P1-T14, P1-T18 context, P1-T19 turns, P1-T20 HTTP, then the
client screens and P1-T25). No branch open.

## Recent changes
- 2026-11-05: Mike's decision: CLAUDE.md's Never line now reads "game state and its history change
  only through commits (ARCH-040)", matching ARCH-040's new wording.
- 2026-11-05: P1-T21 merged (#37): the client foundation: routes with placeholder screens,
  `theme.house` as CSS variables, a typed API layer, one `EventSource` per open campaign, and twelve
  shadcn components at 44 px. Mike's decisions: `cn`, `tw-animate-css`, and `shadcn` approved
  (CONV-091); ADR-020 (native build tools) accepted; lint and tests ignore `.claude/worktrees/`.
  Rulings: UI-101 and CONV-101 amended; the dev proxy sets `xfwd: true`.
- 2026-11-05: P1-T08 merged (#36): the pack and library loader, reporting every issue in three
  passes. Mike's decisions: nested keys checked; library issues only for packs that use them;
  relative library paths; a data-directory pack wins; `aboutRef` names an earlier entry (SCH-090);
  starting items checked against the setting's slot schema (SCH-082). Rulings: three reference
  checker gaps fixed; SCH-092 checked at load.
- 2026-11-05: P1-T05 merged (#35): `core/state/`: `orderSets` (depth, stage, `seq`), the lenient
  `fold`, the strict `validateSet`, and the commit allowlist. Mike's decisions: `orderSets` is
  TRN-061's only definition; relationships are between characters (CON-073); `override.record` is
  allowed in any superseding set (TRN-080). Rulings: TRN-064 names, consolidation grants, SCH-117.
- 2026-11-05: P1-T07 merged (#34): the `node:sqlite` wrapper, migration 0001 with TRN-001 triggers,
  repositories, and campaign folders. Mike's decisions: ARCH-040 names what is not a commit; one
  transaction per write; `DatabaseSync` (ADR-012 amended). Ruling: ARCH-130 calls assets campaign
  state, not a projection.
- 2026-11-05: P1-T10 merged (#33): verbatim provider types (now in the spec check), the registry,
  the mock adapter, and token calibration. Mike's decisions: calibration keyed by profile and model
  (PRV-071 reworded); a JSON placeholder table; `estimateTokens` stays in providers for now.
- 2026-11-05: P1-T16 merged (#32): scrypt PIN, sliding 30-day sessions, rate limit, and the
  localhost exemption. Mike's decisions: a PIN change ends every session; a broken config admits
  only localhost. Ruling: ARCH-110 names CON-113's session routes.
- 2026-11-05: P1-T09 merged (#31): the event bus, per-campaign replay buffers, and SSE frames.
  Mike's decisions: each stream starts at the current event ID; ADR-001 amended to per-campaign.
- 2026-11-05: Mike's decision: wall time comes from an injected `TimeSource` in contracts, not a
  `Clock`, which the glossary reserves for the progress tracker (CONV-061, ARCH-010, glossary).
- 2026-11-05: P1-T04 merged (#30): hard floor, ruleset and gear checks, names, and budgets. Mike's
  decisions: CTX-030's 10% margin, CTX-031's caps on trimmable tiers only, `core` in folders.

## Pending decisions
- **Avoiding merge conflicts between parallel branches** (raised 2026-11-05, this session): every
  parallel branch appends to the same closing-section tables, so each merge made the next PR
  conflict. Options: (a) create empty Traps, Decisions, and Open sections in every document and
  keep rows ordered by the requirement ID they cite (an OVR-035 change); (b) leave the layout as it
  is. Separately: may Claude merge a reviewed batch in order once CI passes, as a standing rule in
  CLAUDE.md, rather than per batch? Claude's suggestion: (a), plus the standing rule. Blocks:
  nothing; worth settling before the next parallel round.

## Loose ends
- Unpushed on `main`: 11bf8d2 (CLAUDE.md) and this status commit.
- Acceptance checklists left unticked though the completion notes show each item tested: P1-T05
  (6 items) and P1-T08 (5). P1-T07's "deleting an open campaign works on Windows (CI)" is unticked;
  CI passed on windows-latest for #34.
- Not tested, owned by later work: PRV-062's re-enqueue on open (P1-T13); UI-042's horizontal
  scroll at phone width (P1-T23, P1-T25); ARCH-061's export exclusion and TRN-003's range rewrites
  (phase 2).
