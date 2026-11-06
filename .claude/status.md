# Status: Mythos
Updated: 2026-11-06 · Through: 9cee5bf · Branch: main

## Current focus
Phase 1 (Foundation): 17 of 25 tasks done. P1-T14 (structured-output pipeline, streaming, call
records) merged as PR #42. Ready to start: P1-T15 (probe and provider health) and P1-T18 (context
module and narrator templates). No branch open.

## Recent changes
- 2026-11-06: P1-T14 merged (#42): `callStructured` and `streamText`, `routeRole`, schema adaptation,
  and one model call record per call. Mike's decisions: the format instruction is a system message
  after the leading system messages (PRV-050 reworded); `ModelCallAttempt` gains `error` for a
  provider failure (03-contracts). Rulings: PRV-052's full Anthropic list (`oneOf` becomes `anyOf`);
  PRV-053 switches once, and success after it is `fallback`; refusals; one delta with streaming off;
  role sampling overrides key by key; an unassigned illustrator is `not_configured`.
- 2026-11-06: Mike's decision: issue #17 closed by hand. #38 ("Closes #17") merged, but GitHub
  never closed the issue.
- 2026-11-06: Claude's ruling: CON-112 and 06-turn-engine §11's phase-1 row say turn zero has one
  `setup` set, matching SCH-117. P1-T17 had fixed only SCH-112 and TRN-056.
- 2026-11-06: P1-T12 merged (#41): the Anthropic adapter, using raw `fetch`, `output_config.format`,
  cache breakpoints, and thinking blocks. Mike's decisions: API version `2026-10-21` and no sampling
  settings; thinking `off` sends `disabled`, and a model that refuses it fails with a message naming
  `provider-default`; `tool-call` forces one tool with `strict`. Rulings: PRV-043 and CTX-011
  reworded; every 400 on a thinking-off profile gets that hint; `x-api-key`.
- 2026-11-06: P1-T11 merged (#40): the Ollama and OpenAI-compatible adapters, plus the shared helpers
  (`http.ts`, `lines.ts`, `think-tags.ts`, the fake server) and `createAdapter(config, deps)`. Mike's
  decisions: `timeoutMs` is an idle timeout; missing usage is estimated from `charsPerToken`; Ollama's
  `tool-call` falls back to plain text. Rulings: PRV-013 (`details.retryAfterSeconds`, errors inside
  a 200 reply, refusals) and CONV-113 reworded.
- 2026-11-06: P1-T17 merged (#38): campaign creation: `buildSetup` in `core`, `writeCampaignStart`
  in one transaction, and the turn module's `createCampaign` and views. Mike's decisions: setup
  warnings are logged, not stored; MEM-035 allows `inferred` grants from setup; GEAR-090 waits for
  phase 6. Rulings: SCH-117's order, SCH-116's claims, the root turn's `gameTimeStart`, and refusing
  a campaign ID whose folder exists.
- 2026-11-06: P1-T13 merged (#39): the job queue. Mike's decisions: jobs resume at server start and
  before a campaign's first new job (PRV-062 reworded); `runInteractive` retries; `JobHandler`
  gains `onFailed`; a device missing from config runs at concurrency 1. Rulings: backoff ×4 capped
  at 30 s, honouring `retryAfterSeconds`; only `retryable: true` errors are retried.
- 2026-11-05: Mike's decision: CLAUDE.md lets Claude merge a batch he approves, in order, on green CI
  on macOS and Windows. The closing-section layout stays as it is; conflicts are resolved at rebase.
- 2026-11-05: Mike's decision: CLAUDE.md gains "Context handoffs": at a natural stopping point,
  Claude offers a handoff block for a fresh session.
- 2026-11-05: Mike's decision: CLAUDE.md's Never line now reads "game state and its history change
  only through commits (ARCH-040)".
- 2026-11-05: P1-T21 merged (#37): the client foundation: routes, `theme.house`, the typed API
  layer, one `EventSource` per campaign, and twelve shadcn components.

## Pending decisions
None.

## Loose ends
- Acceptance checklists left unticked, though the completion notes name a test for each item:
  P1-T05 (6 items), P1-T08 (5), P1-T12 (3), P1-T17 (6). P1-T07's "deleting an open campaign works
  on Windows (CI)" is unticked; CI passed on windows-latest for #34.
- A 429 message lacks a period before its wait: "…too many requests It asks to wait 12 seconds"
  (`providers/adapters/http-errors.ts`, cosmetic).
- Not tested, owned by later work: PRV-045's `narration.delta` events and PRV-047's incomplete
  narration (P1-T19); CON-112's opening narration (P1-T19); UI-042's horizontal scroll at phone
  width (P1-T23, P1-T25); ARCH-061's export exclusion and TRN-003's range rewrites (phase 2).
