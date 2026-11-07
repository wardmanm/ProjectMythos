# Status: Mythos
Updated: 2026-11-07 · Through: d5317c2 · Branch: main

## Current focus
Phase 1 (Foundation): 21 of 25 tasks done. P1-T20 (HTTP routes and the composition root) merged
as PR #46. Ready to start: P1-T22 (library and new campaign), P1-T23 (play screen and inspector),
and P1-T24 (settings and PIN screens). No task branch open.

## Recent changes
- 2026-11-07: P1-T20 merged (#46): the composition root (`app.ts`); `main.ts` with `--data-dir`
  and `--port`; the http module (every phase-1 route, the PIN gate, SSE with replay and the
  keep-alive, the error table, the built client); `rebuild-projections`; `pnpm dev` and
  `pnpm start`. Mike's decisions: deleting a campaign while it narrates is `turn_in_progress`;
  logs go to stdout only in phase 1 (`logs/` is an 01-architecture Open item). Rulings:
  `index.html` only for a GET or HEAD outside `/api` whose last segment has no dot; a stream
  more than 1 MiB behind is closed; 200 with a body and 204 without; a bad path ID is
  `not_found`; Fastify's own refusals are `validation_failed`; turn pages take `limit` 1 to 200,
  default 50; `dev.ts` sends no second signal, so `tsx watch` doesn't force-kill the server.
- 2026-11-06: Mike's decisions: `/sign-off-notes` files, from a second window, what Mike notices
  during a sign-off that fails no check (CONV-141, ADR-021): `sign-off` plus `bug` or
  `enhancement`, P1 in the next phase's milestone, P2 in none, listed under **Found while
  testing**. Rulings from three dry runs: a note that fails a check goes back to `/docs close` as
  a line to paste; a possible blocker is asked about first.
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
- 2026-11-06: Claude's ruling: CON-112 and 06-turn-engine §11's phase-1 row say turn zero has one
  `setup` set, matching SCH-117. P1-T17 had fixed only SCH-112 and TRN-056.

## Pending decisions
None.

## Loose ends
- Spec gap: CTX-081 says the wording of the `tone` and `narration-style` partials is defined in
  `13-content-settings.md`, which defines only the content-settings wording. Found in a
  `/sign-off-notes` dry run; not yet looked into.
- Acceptance checklists left unticked, though the completion notes name a test for each item:
  P1-T05 (6 items), P1-T08 (5), P1-T12 (3), P1-T17 (6). P1-T07's "deleting an open campaign works
  on Windows (CI)" is unticked; CI passed on windows-latest for #34.
- A 429 message lacks a period before its wait when the provider's text has none: "…too many
  requests It asks to wait 12 seconds" (`providers/adapters/http-errors.ts`, cosmetic).
- `pnpm dev` and `pnpm start`, and stopping them with Ctrl+C, were tried by hand on macOS only
  (P1-T20); CI ran the tests on Windows.
- Not tested, owned by later work: PRV-091's model pickers in the UI (P1-T24; the route has a test
  since P1-T20); PRV-090's suggested settings in the UI (P1-T24); UI-042's horizontal scroll at
  phone width (P1-T23, P1-T25); ARCH-061's export exclusion and TRN-003's range rewrites
  (phase 2); ARCH-072, narration blocked on extraction (phase 4).
