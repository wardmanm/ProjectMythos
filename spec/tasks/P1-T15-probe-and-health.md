# P1-T15: Probe and provider health

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T11, P1-T14 |
| **Branch** | `p1-t15-probe-and-health` |

## Goal

Let the settings screen test a model profile and show each provider's status.

## Read

- `spec/05-providers.md` §6 (PRV-067), §9 (PRV-090 to PRV-092), PRV-031
- `spec/03-contracts.md` §14.1 (`ProbeResult`, `ProviderStatus`)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

PRV-031, PRV-090, PRV-091, PRV-092

## Outputs

- `apps/server/src/modules/providers/probe.ts`, `health.ts`, tests
- Exports from the providers `index.ts`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Adapter files

## Design notes

- The probe calls the profile's adapter directly through `runInteractive` with
  `campaignId: null`, adapts schemas with P1-T14's `schema-adapt`, sends
  `role: 'narrator'`, and records nothing (PRV-092). It sends a short text
  prompt (measuring prompt and generation speed from usage and timing), then the same
  tiny structured request with each method the provider supports, and reports which
  produced valid output. `suggestions` recommend the fastest valid method, a context
  window warning below 8,192 tokens (CTX-032), and turning thinking off if it was
  emitted while the profile says `off`.
- Health calls each adapter's `health` with a five-second timeout, in parallel.

## Acceptance

- [x] With the mock adapter scripted to fail `json-schema` and pass `tool-call`, the probe reports exactly that and suggests `tool-call`.
- [x] A provider that times out reports `reachable: false` with a plain-words `detail`.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/providers/`:
    - `probe.ts`: `createProbe`: the profile's listing, one structured request per
      method and then the text request, each as an interactive job timed inside the job;
    - `probe-prompts.ts`: what the probe sends: the tiny structured request, its schema
      `ProbeAnswerSchema` (an object of an inn's name and its rooms), and the text prompt
      of about 1,000 tokens (754 words, 4,147 characters with the hard floor);
    - `probe-report.ts`: the pure half: each method's check, the speeds, model names, and
      the suggestions;
    - `health.ts`: `createHealthCheck`, every provider at once, 5 seconds each;
    - `mock-outputs.ts`: a `probe` entry in `jsonPlaceholders`;
    - `probe-testing.ts`: the probe tests' harness, not exported;
    - `index.ts`: `createProbe`, `ProbeOptions`, `ProviderProbe`, `createHealthCheck`,
      `HealthCheck`, `HealthCheckOptions`, `ProviderStatus`, and `HEALTH_TIMEOUT_MS`;
    - `README.md`: the Public API, a "Probe and health" section, the mock's placeholder,
      Files, and the governing spec.
  - 33 tests in three files: `probe.test.ts` (18: methods, reachability, speed, thinking,
    and the context window), `probe-requests.test.ts` (9: what the probe sends, and
    PRV-092), and `health.test.ts` (6). The probe tests run a real queue and the mock
    adapter, with fake time and campaigns and an event bus that only remember being
    used; no test touches the network (CONV-113).
  - Acceptance, by test:
    - `PRV-031, PRV-090: json-schema output that does not parse and tool-call output that
      does are reported, and tool-call is suggested`, with a second variant in which the
      provider rejects `json-schema`;
    - `PRV-091: a provider that does not answer within 5 seconds is unreachable, in plain
      words`.
  - `pnpm check` passes on a branch that contains `origin/main` (e14dc84). The workspace
    has `Tests  932 passed (932)` and `spec/reference` `Tests  271 passed (271)`, and it
    ends with `Docs check passed: 834 requirements, 25 tasks (18 done), 20 ADRs, 83
    markdown files, 1189 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, answering the plan, 2026-11-06), each a 05-providers
    Decisions row, Decided by `owner`:
    - Q1: the probe's work returns every failure with `retryable: false`, so the queue
      never retries a probe request: one try per method.
    - Q2: the structured requests go first and the text request last, so the model is
      loaded when speed is measured, and the text prompt is about 1,000 tokens. PRV-090
      is reworded in place (OVR-034), in `P1-T15: spec: PRV-090 sends the structured
      requests first, then a text prompt of about 1,000 tokens`. It said "a short prompt
      and a tiny structured request with each method"; it now says "a tiny structured
      request with each method, then a text prompt of about 1,000 tokens". This task's
      design notes still describe the old order, since only Status and Completion notes
      may change here.
    - Q3: a `probe` entry in the mock's `jsonPlaceholders`, with a test that it parses
      with `ProbeAnswerSchema`. The PRV-083 row's "The table is empty in phase 1" now
      says it holds only the probe's schema.
    - Q4: the probe's schema keeps an object root. The 05-providers Open entry on a union
      root at an Anthropic schema's root now says the probe cannot settle it, and a
      one-off manual probe with a union-root schema could.
    - The thinking suggestion says to turn thinking off on the server, since the profile
      already says `off`.
    - The health timeout is 5 seconds.
  - **Spec fix** (CONV-133), in `P1-T15: spec: the probe's and the status list's
    decisions, and the union-root Open entry`: the 05-providers Decisions row "How do
    `health` and `listModels` reach a provider (PRV-091)?" gains a clause: the status
    list's 5-second limit (`health.ts`) applies on top of the 10-second idle timeout, to
    the whole check.
  - **Changed from the plan by Q2:** the plan's "a failed text request stops the probe"
    no longer applies, since the text request is last. A failed model list still ends
    the probe before any model request; otherwise every request is sent whatever the
    earlier ones gave, and a failed text request leaves both speeds null and adds its
    message to the suggestions.
  - **05-providers Decisions, Claude (ruling)**, appended at the end of the table:
    - the status list checks providers at once, in config order; a check that throws is
      logged and unreachable; a config that fails to load returns its error;
    - only the model requests run as jobs; `listModels` is called directly;
    - what the probe sends: the narrator role, the profile's own sampling and
      `maxOutputTokens`, the hard floor in every prompt (CSET-040), and only the listing
      for an embedding profile;
    - speeds and the fastest method: timed inside each job; prompt speed counts the
      uncached input tokens; with thinking, only generation speed, over the whole call;
      ties go to `json-schema`, then `tool-call`; the text prompt opens with the probe's
      start time, so a server's prompt cache cannot reuse an earlier probe's prompt;
    - when the probe stops early, and an Ollama name with no tag matching its `:latest`;
    - what `suggestions` hold, in order, with each distinct provider message once.
  - **Extra files** (CONV-132):
    - `mock-outputs.ts`, an adapter file, for the `probe` entry only, as Mike approved
      (Q3).
    - As the plan allowed: `probe-report.ts`, so `probe.ts` stays under CONV-014's 300
      lines.
    - Not in the plan: `probe-prompts.ts`, for the 1,000-token prompt Q2 asked for, and
      `probe-testing.ts` with `probe-requests.test.ts`, since one test file would have
      been 602 lines, over CONV-014's 500.
  - **Smaller calls:**
    - `statuses()` returns a `Result`, with the config's error when it fails to load,
      rather than a bare array.
    - `createProbe` returns `{ probe }` and `createHealthCheck` `{ statuses }`, typed as
      properties, not methods, so a caller may destructure them.
    - A thrown health check is logged as a warning, since a `comfyui` provider would
      throw on every poll until phase 9. Its detail is "<provider> could not be
      checked."; a timeout's names the provider as the adapters do, such as "lm-studio
      (OpenAI-compatible) at http://localhost:1234".
    - A method's answer is checked with the schema alone, with no semantic check. A
      refusal counts as invalid.
    - Speeds are not rounded; the settings screen formats them.
    - `ProviderStatus` is `z.infer` of contracts' `ProviderStatusSchema`, which contracts
      exports without a type, and `packages/` is off-limits.
    - A profile that is not in machine config is `not_found`, and a provider with no
      `text` member `not_configured`, as in the model calls.
    - "No calibration runs" (PRV-092) holds by construction: `ProbeOptions` has no
      calibration. The test shows that no campaign is opened and no event published.
    - The Acceptance checklist is ticked.
- **Pending decisions:** None.
- **Not tested:**
  - PRV-090 (the UI suggests settings from the result): the settings screen, in P1-T24.
    The probe's `suggestions` are tested here.
  - PRV-091 (`listModels` populates model pickers): the settings routes arrive in P1-T20
    and the pickers in P1-T24; each adapter's `listModels` was tested in P1-T11 and
    P1-T12. The status list `health` drives is tested here.
- **Dependencies:** None.
