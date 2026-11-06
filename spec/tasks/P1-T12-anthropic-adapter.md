# P1-T12: Anthropic adapter

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T10 |
| **Branch** | `p1-t12-anthropic-adapter` |

## Goal

Talk to the Anthropic Messages API, with prompt-cache breakpoints, streaming,
structured output, and the schema adaptation Anthropic needs.

## Read

- `spec/05-providers.md` §3 (PRV-010 to PRV-013, PRV-040 to PRV-043), §4, §5 (PRV-052)
- `spec/09-context.md` CTX-010, CTX-011
- Anthropic's current Messages API documentation, including streaming events, prompt caching, tool use, and structured outputs (PRV-042)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

PRV-010, PRV-011, PRV-012, PRV-013, PRV-040, PRV-041, PRV-042, PRV-043, PRV-045, PRV-046, PRV-047, CTX-011

## Outputs

- `apps/server/src/modules/providers/adapters/anthropic.ts` and its test
- Registry case
- Providers `README.md` section

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other providers files except the registry

## Design notes

- System messages become the `system` parameter as content blocks; a message with
  `cacheBreakpoint` gets `cache_control: { type: "ephemeral" }` on its block (PRV-041).
  Consecutive same-role messages are merged into one message with one block each,
  keeping their breakpoints (PRV-043, CTX-011).
- Check the documentation for the current structured-output mechanism (PRV-040) and
  record what you used, with the documentation date, in the README and completion notes.
- The adapter receives JSON Schemas already adapted by the pipeline (PRV-050 step 2,
  PRV-052, built in P1-T14); it does not adapt them itself.
- Thinking blocks go to `TextResponse.thinking`, never to `onDelta` (PRV-046).
- Abort as PRV-047, like the other adapters.
- Report `cache_read_input_tokens` as `cachedInputTokens`.
- Test against a fake server built with `node:http`.

## Acceptance

- [ ] A three-tier prompt produces system blocks and user content blocks with cache breakpoints exactly where CTX-010 puts them.
- [ ] Streamed text and thinking are separated; usage includes cached tokens.
- [ ] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/providers/adapters/`: `anthropic.ts` (`generate`,
    `listModels`, `health`), `anthropic-request.ts` (the pure request builder), and
    `anthropic-stream.ts` (the event schemas and the fold into a `TextResponse`), with
    tests in `anthropic.test.ts`, `anthropic-errors.test.ts`,
    `anthropic-request.test.ts`, and `anthropic-stream.test.ts`, which share the
    test-only `anthropic-testing.ts`. Every adapter test runs against the fake server on
    127.0.0.1. `registry.ts` builds the adapter; the providers README has an Anthropic
    section.
  - **Structured output:** `json-schema` uses the native JSON outputs,
    `output_config: { format: { type: 'json_schema', schema } }`, generally available with
    no beta header; the answer is the text block. The older `output_format` is deprecated
    and not used. `tool-call` forces one strict tool. Both are from Anthropic's
    documentation read on 2026-11-05, which the README links (PRV-042).
  - Acceptance, by test:
    - 1: `PRV-041, CTX-011: a three-tier prompt gets cache_control exactly where CTX-010
      puts it, and nowhere else`, on the body the fake server received, with the merging
      tests in `anthropic-request.test.ts`;
    - 2: `PRV-046: thinking goes to thinking, never to onDelta, and usage includes cached
      tokens`;
    - 3: `pnpm check` passes, below.
  - Mike's thinking-off message has its test: `PRV-013: a model that cannot turn thinking
    off gets Anthropic's explanation and the setting to change`.
  - `pnpm check` passes, stacked on P1-T11's `8d60250` and not yet rebased onto `main`.
    The workspace has `Tests  706 passed (706)` and `spec/reference` `Tests  271 passed (271)`,
    and it ends with `Docs check passed: 834 requirements, 25 tasks (13 done), 20 ADRs, 82
    markdown files, 883 citations in code.`
- **Rulings:**
  - **Owner's decisions of 2026-11-05** (`P1-T12: spec: owner: Anthropic version,
    sampling, thinking, and tool-call`): three 05-providers Decisions rows, for the
    version and sampling, what each `thinking` setting sends, and how `tool-call` forces
    its tool, and an Open bullet asking P1-T24 to suggest `provider-default` for
    Anthropic profiles and P1-T15's probe to show the message.
  - **PRV-043 and CTX-011, spec fix** (`P1-T12: spec: PRV-043 and CTX-011 wording, and the
    Anthropic adapter's rulings`): both named Anthropic as an API that requires
    alternating roles, but it now combines same-role messages itself. The adapter still
    merges them, so only the wording changes.
  - **05-providers closing sections**, in the same commit:
    - Traps: Anthropic's usage comes in pieces; thinking is empty without
      `display: 'summarized'`; a spend-cap 429 has no `retry-after` and keeps failing.
    - Decisions, Claude (ruling): system messages; empty messages, their breakpoints,
      and the limit of four; usage; `finishReason`; mid-stream `error` events; always
      streaming; the structured-output method from the profile; thinking blocks;
      `health`; `baseUrl` without `/v1`; and why the thinking-off hint is worded for any
      400 rather than matched to Anthropic's message (CONV-042).
    - Open: no `anthropic-workspace-id`; PRV-052 leaves out some of Anthropic's schema
      limits, for P1-T14.
  - **`timeout_error` in the stream is `provider_timeout`**, a case the approved
    mapping did not list, which would otherwise have been `provider_rejected`; PRV-013
    makes a timeout retryable. Included in the Decisions row.
  - **Extra files** (CONV-132): `anthropic-request.ts`, `anthropic-stream.ts`, and their
    tests, as planned; `anthropic-errors.test.ts` and `anthropic-testing.ts`, because
    `anthropic.test.ts` would otherwise exceed CONV-014's 500 lines; and
    `registry.test.ts`, which loses its anthropic row. The PRV-010 test sits in
    `anthropic.test.ts`, so `registry.test.ts` changes by one line.
  - **Smaller calls:**
    - The key goes in `x-api-key`; the README notes that newer SDKs send
      `Authorization: Bearer`.
    - A message whose text is only whitespace counts as empty, since the API refuses a
      block with no visible text. A breakpoint on an empty first message has no block to
      move to and is dropped.
    - A delta type the documentation does not list is an unreadable response
      (`provider_unavailable`), since it might carry answer text; unknown event types
      are skipped.
    - A `tool_use` block that streams no input is `{}`. Only the first `tool_use`
      block is read. The tool is sent with `name`, `input_schema`, and `strict`, and no
      description.
    - A cancelled call's output estimate counts its thinking and its answer text. A
      stream with no input counts at all, which the documentation never shows, would
      estimate the prompt from the profile's `charsPerToken`.
    - `health` and `listModels` have no profile, so their idle timeout is 30 seconds.
      `health` gives `latencyMs: null` whenever it is unreachable, a 401 included.
    - `listModels` stops when `has_more` is false or `last_id` is null.
    - `generate` stops reading at `message_stop`.
    - An appended sentence gets the full stop the provider's message lacked, as in
      "invalid x-api-key. Check the API key in Settings."
- **Pending decisions:** None.
- **Not tested:**
  - PRV-042: a documentation requirement. The README records the docs used and the date,
    and the snapshots pin the request shape.
- **Dependencies:** None new. No SDK: the adapter uses `fetch` through P1-T11's
  `sendRequest` (PRV-011, ADR-010).
