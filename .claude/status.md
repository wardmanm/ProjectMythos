# Status: Mythos
Updated: 2026-11-06 · Through: f4562fd · Branch: main

## Current focus
Phase 1 (Foundation): 19 of 25 tasks done. P1-T15 (probe and provider health) merged as PR #43 and
P1-T18 (context module and narrator templates) as PR #44. Ready to start: P1-T19 (turn module:
linear turns). No branch open.

## Recent changes
- 2026-11-06: P1-T18 merged (#44): the context module (`createContextBuilder`, `narration` and
  `preview`), Handlebars templates in six layers, budgets, the CTX-010 layout, and the engine's
  `narrator.md` with six partials. Mike's decisions: tier marker lines (CTX-003 amended);
  `estimateTokens` moves to `core`; the budget takes `reservedTokens` (0 for the narrator); a scene
  still too big after its last trim is kept whole. Rulings: text before the first marker fails;
  "involved" includes named characters who aren't present; the scene trims personalities first; the
  13-content-settings floor row no longer says "after the output-format instructions".
- 2026-11-06: P1-T15 merged (#43): `createProbe` and `createHealthCheck`. Mike's decisions: one try
  per method; structured requests first, then a text prompt of about 1,000 tokens (PRV-090
  reworded); a `probe` placeholder in the mock; an object root; a 5-second health limit. Rulings:
  only a failed listing stops the probe early; prompt speed counts uncached tokens; `listModels` runs
  outside the queue; a health check that throws is reported unreachable.
- 2026-11-06: P1-T14 merged (#42): `callStructured` and `streamText`, `routeRole`, schema adaptation,
  and one model call record per call. Mike's decisions: the format instruction is a system message
  after the leading system messages (PRV-050 reworded); `ModelCallAttempt` gains `error` for a
  provider failure (03-contracts). Rulings: PRV-052's full Anthropic list; PRV-053 switches once,
  and success after it is `fallback`; refusals; role sampling overrides key by key.
- 2026-11-06: Mike's decision: issue #17 closed by hand. #38 ("Closes #17") merged, but GitHub
  never closed the issue.
- 2026-11-06: Claude's ruling: CON-112 and 06-turn-engine §11's phase-1 row say turn zero has one
  `setup` set, matching SCH-117. P1-T17 had fixed only SCH-112 and TRN-056.
- 2026-11-06: P1-T12 merged (#41): the Anthropic adapter. Mike's decisions: API version
  `2026-10-21` and no sampling settings; thinking `off` sends `disabled`, and a model that refuses it
  fails with a message naming `provider-default`; `tool-call` forces one tool with `strict`.
- 2026-11-06: P1-T11 merged (#40): the Ollama and OpenAI-compatible adapters, the shared helpers,
  and `createAdapter(config, deps)`. Mike's decisions: `timeoutMs` is an idle timeout; missing usage
  is estimated from `charsPerToken`; Ollama's `tool-call` falls back to plain text.
- 2026-11-06: P1-T17 merged (#38): campaign creation: `buildSetup` in `core`, `writeCampaignStart`,
  and the turn module's `createCampaign` and views. Mike's decisions: setup warnings are logged, not
  stored; MEM-035 allows `inferred` grants from setup; GEAR-090 waits for phase 6.
- 2026-11-06: P1-T13 merged (#39): the job queue. Mike's decisions: jobs resume at server start and
  before a campaign's first new job (PRV-062 reworded); `runInteractive` retries; `JobHandler`
  gains `onFailed`; a device missing from config runs at concurrency 1.
- 2026-11-05: Mike's decision: CLAUDE.md lets Claude merge a batch he approves, in order, on green CI
  on macOS and Windows. The closing-section layout stays as it is; conflicts are resolved at rebase.

## Pending decisions
None.

## Loose ends
- Acceptance checklists left unticked, though the completion notes name a test for each item:
  P1-T05 (6 items), P1-T08 (5), P1-T12 (3), P1-T17 (6). P1-T07's "deleting an open campaign works
  on Windows (CI)" is unticked; CI passed on windows-latest for #34.
- A 429 message lacks a period before its wait: "…too many requests It asks to wait 12 seconds"
  (`providers/adapters/http-errors.ts`, cosmetic).
- Not tested, owned by later work: PRV-045's `narration.delta` events and PRV-047's incomplete
  narration (P1-T19); CON-112's opening narration (P1-T19); PRV-091's model pickers (P1-T20,
  P1-T24); PRV-090's suggested settings in the UI (P1-T24); UI-042's horizontal scroll at phone
  width (P1-T23, P1-T25); ARCH-061's export exclusion and TRN-003's range rewrites (phase 2).
