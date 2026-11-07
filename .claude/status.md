# Status: Mythos
Updated: 2026-11-06 · Through: a131949 · Branch: main

## Current focus
Phase 1 (Foundation): 20 of 25 tasks done. P1-T19 (turn module: linear turns) merged as PR #45.
Ready to start: P1-T20 (HTTP routes and the composition root). No task branch open.

## Recent changes
- 2026-11-06: Mike's decisions: `/sign-off-notes` files what Mike notices during a sign-off that
  fails no check, from a second window (CONV-141, ADR-021, mirroring rollcall_derby). Labels
  `sign-off` plus `bug` or `enhancement`; P1 in the next phase's milestone, P2 in none; listed
  under **Found while testing** in the phase plan; Known issues include its P1 bugs (CONV-137);
  the next plan's P1 changes and features go to Mike. The docs skill's Close section takes its
  lines, asks skips again, and finds board cards past 30. Rulings, from three dry runs: a note that
  fails any check goes back to `/docs close` as a line to paste, tracked until handled; a possible
  blocker is asked about first; a note a later phase plans is filed only if Mike asks.
- 2026-11-06: P1-T19 merged (#45): the turn module's `submitAction`, streamed narration, Stop,
  retry, startup recovery, and turn and branch views; core's `entriesInOrder`; storage's
  `appendSet` with a status, `abandonTurn`, and turn reads. Mike's decisions: `regenerate`
  returns `{ turnId }` for an interactive stage; `entriesInOrder` is the one way a read point's
  sets are ordered. Rulings (06-turn-engine Decisions): a narration commits only the text sent
  as deltas, cut at 20,000 characters; no text leaves the turn `stage-failed`; `cancel` abandons a
  non-root failed turn; shutdown commits partial text.
- 2026-11-06: P1-T18 merged (#44): the context module (`createContextBuilder`, `narration` and
  `preview`), Handlebars templates in six layers, budgets, the CTX-010 layout, and the engine's
  `narrator.md` with six partials. Mike's decisions: tier marker lines (CTX-003 amended);
  `estimateTokens` moves to `core`; the budget takes `reservedTokens` (0 for the narrator); a scene
  still too big after its last trim is kept whole.
- 2026-11-06: P1-T15 merged (#43): `createProbe` and `createHealthCheck`. Mike's decisions: one try
  per method; structured requests first, then a text prompt of about 1,000 tokens (PRV-090
  reworded); a `probe` placeholder in the mock; an object root; a 5-second health limit.
- 2026-11-06: P1-T14 merged (#42): `callStructured` and `streamText`, `routeRole`, schema adaptation,
  and one model call record per call. Mike's decisions: the format instruction is a system message
  after the leading system messages (PRV-050 reworded); `ModelCallAttempt` gains `error`.
- 2026-11-06: Mike's decision: issue #17 closed by hand. #38 ("Closes #17") merged, but GitHub
  never closed the issue.
- 2026-11-06: Claude's ruling: CON-112 and 06-turn-engine §11's phase-1 row say turn zero has one
  `setup` set, matching SCH-117. P1-T17 had fixed only SCH-112 and TRN-056.
- 2026-11-06: P1-T12 merged (#41): the Anthropic adapter. Mike's decisions: API version
  `2026-10-21` and no sampling settings; thinking `off` sends `disabled`; `tool-call` forces one
  tool with `strict`.
- 2026-11-06: P1-T11 merged (#40): the Ollama and OpenAI-compatible adapters, the shared helpers,
  and `createAdapter(config, deps)`. Mike's decisions: `timeoutMs` is an idle timeout; missing usage
  is estimated from `charsPerToken`; Ollama's `tool-call` falls back to plain text.
- 2026-11-06: P1-T17 merged (#38): campaign creation: `buildSetup` in `core`, `writeCampaignStart`,
  and the turn module's `createCampaign` and views. Mike's decisions: setup warnings are logged, not
  stored; MEM-035 allows `inferred` grants from setup; GEAR-090 waits for phase 6.

## Pending decisions
None.

## Loose ends
- `main` is ahead of `origin/main` by the sign-off-notes commit and this status commit; not
  pushed until Mike says so.
- Spec gap: CTX-081 says the wording of the `tone` and `narration-style` partials is defined in
  `13-content-settings.md`, which defines only the content-settings wording. Found in a
  `/sign-off-notes` dry run; not yet looked into.
- Acceptance checklists left unticked, though the completion notes name a test for each item:
  P1-T05 (6 items), P1-T08 (5), P1-T12 (3), P1-T17 (6). P1-T07's "deleting an open campaign works
  on Windows (CI)" is unticked; CI passed on windows-latest for #34.
- A 429 message lacks a period before its wait: "…too many requests It asks to wait 12 seconds"
  (`providers/adapters/http-errors.ts`, cosmetic).
- Not tested, owned by later work: PRV-091's model pickers (P1-T20, P1-T24); PRV-090's suggested
  settings in the UI (P1-T24); UI-042's horizontal scroll at phone width (P1-T23, P1-T25);
  ARCH-061's export exclusion and TRN-003's range rewrites (phase 2); ARCH-072, narration blocked
  on extraction (phase 4).
