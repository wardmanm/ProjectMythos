# P1-T14: Structured-output pipeline, streaming, call records

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T13 |
| **Branch** | `p1-t14-structured-pipeline` |

## Goal

Implement `callStructured` and `streamText` on top of the queue: schema
conversion and adaptation, format instructions, extraction and repair of JSON,
validation with retries, the prompt-only fallback, and a model call record for every
call.

## Read

- `spec/05-providers.md` §2.2 (PRV-001), §3.1 (PRV-040), §4, §5 (the code block and PRV-050 to PRV-054), §6 (PRV-067), §7
- `spec/03-contracts.md` §1 (CON-003 to CON-005), §14.1
- `spec/09-context.md` §9 (CTX-090)
- `spec/01-architecture.md` §4.4 (ARCH-060, ARCH-061)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-060, ARCH-061, PRV-001, PRV-040, PRV-045, PRV-046, PRV-047, PRV-050, PRV-051, PRV-052, PRV-053, PRV-054, PRV-061, PRV-067, PRV-071, CON-004, CONV-032

## Outputs

- `apps/server/src/modules/providers/structured.ts` (the 05-providers §5 types verbatim, then the implementation), `schema-adapt.ts`, `role-routing.ts`, `records.ts`, tests
- Providers `README.md` section

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Adapter files

## Design notes

- **Role routing.** The role's assignment comes from machine config's `roles`. An
  unassigned role fails with `not_configured` naming the role (PRV-001); `npc-voice`
  falls back to the narrator's assignment. Explicit-content routing (PRV-006) arrives
  in phase 3. Export the routing function so the composition root can also give it to
  the context module (CTX-110).
- **Schema adaptation** (PRV-052) is a pure function per provider: for Anthropic, set
  `additionalProperties: false` on every object and remove the keywords PRV-040 lists;
  the others pass the schema through.
- A call with `job: null` (every call in phase 1) runs through the queue's
  `runInteractive` on the profile's device; a call given a `JobContext` runs in that
  job's slot under its signal (PRV-067). Test both.
- **Records.** Every call writes one `ModelCallRecord` through storage, with every
  attempt, the messages, and the caller's `PromptReport` (PRV-054). Calls without a
  campaign (the probe) are not recorded.
- After each call, feed the reported input tokens to calibration (PRV-071).
- `streamText` forwards deltas to the caller's `onDelta` and returns `StreamedText`:
  the text and its `finishReason`. On cancel it returns what arrived with
  `finishReason: 'cancelled'` and marks the record `cancelled` (PRV-047).
- Use `jsonrepair` for step 5 of PRV-050 (approved in CONV-091).

## Acceptance

- [x] PRV-050: with the mock adapter, a first answer with a code fence and trailing prose parses; a second with a schema error retries with the issues listed; a third failure returns `model_output_invalid` with all three attempts in `details`.
- [x] PRV-053: `provider_rejected` on `json-schema` retries once as `prompt-only` and the record shows the switch.
- [x] PRV-054: failed attempts are recorded; the record parses with `ModelCallRecordSchema` when read back.
- [x] PRV-052: the Anthropic-adapted schema has `additionalProperties: false` on every object and none of the unsupported keywords.
- [x] PRV-001: a call for an unassigned role fails with `not_configured` naming the role.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/providers/`:
    - `structured.ts`: the 05-providers §5 code block, byte for byte, above a divider,
      then `createModelCalls`, `callStructured`'s loop, and `streamText`;
    - `model-call.ts`: routing, each adapter call in its job's slot or as an interactive
      job, attempts, calibration, and the record;
    - `structured-output.ts`: the pure steps: the format instruction and its example,
      extraction, validation, and retry feedback;
    - `schema-adapt.ts`, `role-routing.ts`, and `records.ts`;
    - `structured-testing.ts`: a test harness, not exported;
    - `index.ts`: the new exports;
    - `README.md`: a "Model calls" section, the Public API, the Files list, and the
      governing spec.
  - 52 tests in five files: `schema-adapt.test.ts`, `structured-output.test.ts`,
    `role-routing.test.ts`, `structured.test.ts` (`callStructured`), and
    `structured-stream.test.ts` (`streamText`). The pipeline tests run a real queue, a
    real campaign database, and the mock adapter; only time and calibration are fakes.
  - `jsonrepair` 3.15.0 in `apps/server` (approved in CONV-091; published 2026-07-03, so
    `pnpm-workspace.yaml` is unchanged).
  - Acceptance, by test:
    - PRV-050: `an answer in a code fence with trailing prose parses`, `a schema error
      retries with the issues listed`, and `a third failure returns model_output_invalid
      with every attempt`;
    - PRV-053: `provider_rejected on json-schema retries once as prompt-only, and the
      record shows it`;
    - PRV-054: the third-failure test reads the record back through storage and parses
      it with `ModelCallRecordSchema`, with each failed attempt's issues;
    - PRV-052: `the Anthropic ruling schema closes every object and keeps no unsupported
      keyword`, run on the real `RulingSchema`;
    - PRV-001: `a call for an unassigned role fails with not_configured naming the role`,
      in `routeRole` and through `callStructured`.
  - `pnpm check` passes on a branch that contains `origin/main` (0cef769). The workspace
    has `Tests  899 passed (899)` and `spec/reference` `Tests  271 passed (271)`, and it
    ends with `Docs check passed: 834 requirements, 25 tasks (17 done), 20 ADRs, 83
    markdown files, 1147 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, while planning, 2026-11-06):
    - The format instruction is a system message of its own right after the prompt's
      leading system messages, so the floor repeated in the task tier (CSET-042) stays
      nearest the output. PRV-050 step 3 is reworded, in `P1-T14: spec: PRV-050 places
      the format instruction; PRV-052 lists Anthropic's limits`, with a 05-providers
      Decisions row.
    - `ModelCallAttemptSchema` gains `error: AppErrorSchema.nullable()`, for an attempt
      that got no answer from the provider. This is in the 03-contracts §14.1 code block,
      `spec/reference/contracts/app-api.ts`, and its copy in `packages/contracts`, with a
      03-contracts Decisions row, in `P1-T14: spec: ModelCallAttempt records a provider
      failure in error`.
  - **Spec fix, PRV-052** (CONV-133), in the same commit as PRV-050: the full Anthropic
    adaptation, from Anthropic's structured-outputs page, rechecked 2026-11-06. The
    05-providers Open entry had left it to this task. `oneOf` becomes `anyOf`, since the
    page lists only `anyOf`; `$schema`, `maxItems`, a `minItems` above 1, unlisted
    formats, regex features it refuses, and complex enums are dropped.
  - **05-providers Decisions, Claude (ruling):**
    - PRV-053 switches on any `provider_rejected`, once, without counting a validation
      retry, and `fallback` means success after the switch;
    - a refusal in either call (CSET-050);
    - what a record holds: an attempt per run, the last request's messages, no record
      for a call that reached no model, and a campaign that won't open is logged;
    - `model_output_invalid`'s `details`;
    - one delta for a profile with streaming off, partial text included;
    - `routeRole`'s fallbacks, and an unassigned illustrator;
    - role sampling overriding key by key;
    - what calibration folds in;
    - dropping, not describing, the constraints Anthropic refuses.
  - **05-providers Traps:** `jsonrepair` repairs almost anything.
  - **05-providers Open:**
    - Removed, as done here: the streamed-retry entry, cancelled calls and calibration,
      and PRV-052's missing limits.
    - Added: estimated usage still feeds calibration; limits the Anthropic adaptation
      cannot fix; a union at an Anthropic schema's root is unverified.
  - **09-context Open** (new section): the format instruction is outside the budget,
    for P1-T18.
  - **Extra files** (CONV-132):
    - As planned: `model-call.ts`, `structured-output.ts`, and `structured-testing.ts`,
      plus `apps/server/package.json` and `pnpm-lock.yaml`.
    - Planned but not made: `stream-text.ts`. `streamText` fits in `structured.ts`, which
      is 234 lines with it.
  - **Smaller calls:**
    - `z.toJSONSchema` runs in its default output mode, which already closes `z.object`s.
    - A call given a `JobContext` runs under `AbortSignal.any` of the caller's and the
      job's signals.
    - A config that fails to load returns its own error.
    - A provider with no `text` member is `not_configured`.
    - The minimal example uses `"..."` for strings and a number's `minimum`.
    - A refusal's message points to the record rather than quoting the model.
    - The Acceptance checklist is ticked.
- **Pending decisions:** None.
- **Not tested:**
  - PRV-045 (the `narration.delta` event to the client): the turn module publishes it,
    in P1-T19. `streamText`'s side, forwarding each delta and the one-delta fallback, is
    tested.
  - PRV-047 (partial narration kept as the turn's narration, marked incomplete): the
    turn module, in P1-T19. `streamText` returning the partial text with `finishReason:
    'cancelled'` is tested.
  - ARCH-061 (excluded from exports by default): exports arrive in phase 2. Records
    stored outside the commits are tested here, and retention in P1-T07.
- **Dependencies:** `jsonrepair` 3.15.0, from CONV-091's approved list.
