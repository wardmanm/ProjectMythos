# P1-T10: Provider types, mock adapter, token estimation

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T06 |
| **Branch** | `p1-t10-provider-types-and-mock` |

## Goal

Lay down the providers module: the adapter interface exactly as specified, the mock
adapter every test uses, the adapter registry, and token estimation with calibration.

## Read

- `spec/05-providers.md` §1, §3 (the code block), §4, §7, §8
- `spec/03-contracts.md` §11, §12, §14.1
- `spec/decisions/ADR-010-no-vendor-sdks.md`

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-133, PRV-012, PRV-070, PRV-071, PRV-080, PRV-081, PRV-083, PRV-084, CONV-113

## Outputs

- `apps/server/src/modules/providers/`: `index.ts`, `types.ts` (the 05-providers §3 code block, verbatim), `registry.ts`, `mock-adapter.ts`, `tokens.ts`, tests, `README.md`
- `apps/server/test/fixtures/model/README.md` describing the fixture layout

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other server modules

## Design notes

- `types.ts` is normative: copy the code block from `05-providers.md` §3 exactly.
- **Registry.** `createAdapter(providerConfig)` switches on `type` (`ollama`,
  `openai-compatible`, `anthropic`, `mock`). Real adapters arrive in P1-T11 and P1-T12;
  until then their cases throw "not implemented".
- **Mock adapter** (PRV-080 to PRV-084): scripted mode (tests enqueue exact
  responses), fixture mode (reads `apps/server/test/fixtures/model/<test-name>/<seq>-<role>.json`,
  each a `TextResponse`; the role comes from `TextRequest.role` and the test name from
  the fixture scope the test gives the mock), and default mode, which returns short plausible text so the
  UI can be developed offline. It streams by calling `onDelta` per word, can delay,
  and can fail with any `ProviderError` code. Add `mock` to the provider types the
  registry accepts; it is configured like any provider.
- **Tokens.** `estimateTokens(text, charsPerToken)` is `ceil(length / ratio)` (PRV-070).
  `calibrate(profileId, estimated, reported)` updates an exponential moving average
  (weight 0.2 for the new sample) stored in `<dataDir>/calibration.json`, never in
  machine config (PRV-071); `charsPerToken(profile)` returns the calibrated ratio, or
  the profile's own until there is one. The context module receives it through
  `ContextDependencies` (CTX-110).
- The mock honors its provider config's `delayMs` between streamed words (PRV-083).

## Acceptance

- [x] PRV-084: each `ProviderError` code can be produced by the mock and has a test.
- [x] PRV-081: fixture mode replays a recorded sequence by test name, role, and sequence number.
- [x] PRV-071: calibration converges toward a constant ratio within ten calls and survives a reload.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/providers/`: `types.ts` (the §3 code block, byte for byte),
    `registry.ts`, `mock-adapter.ts`, `mock-outputs.ts`, `mock-fixtures.ts`,
    `tokens.ts`, `index.ts`, and `README.md`, with 37 tests in four files. The module
    imports no other module yet.
  - `apps/server/test/fixtures/model/`: its `README.md` and two scenarios,
    `prv-081-replay` and `prv-012-wire-format` (deliberately in Ollama's wire format).
  - `scripts/check-spec.ts` compares `providers/types.ts` with
    `spec/reference/server-types/providers/types.ts`; a later pure copy is one more
    `<module>/<file>` entry in `serverTypeCopies`. Three new tests in
    `scripts/check-spec.test.ts`.
  - Acceptance, by test:
    - PRV-084: `%s, retryable %s, HTTP status %s`, an `it.each` over all five codes;
    - PRV-081: `replays by scope, role, and per-role sequence, with roles interleaved`;
    - PRV-071: `converges toward a constant ratio within ten calls` (from 3.5 to
      within 0.15 of 4.5) and `survives a reload`.
  - Verified, then reverted: with the pause moved before each word, the PRV-083 delay
    test and the PRV-084 mid-stream abort test fail; with one byte added to
    `providers/types.ts`, the spec check fails, naming the file.
  - `pnpm check` passes. The workspace has `Tests  240 passed (240)` and
    `spec/reference` `Tests  271 passed (271)`, and it ends with `Docs check passed: 834
    requirements, 25 tasks (6 done), 19 ADRs, 77 markdown files, 307 citations in code.`
- **Rulings:**
  - **Owner's decisions of 2026-11-05** (`P1-T10: spec: owner: calibration by profile
    and model; mock decisions`). PRV-071 is reworded in place: the calibrated ratio is
    kept per profile and model. Five Decisions rows in 05-providers: the JSON
    placeholder table (PRV-083), `fixturesDir` as the scenario folder (PRV-081), the
    spec check for `providers/types.ts` (OVR-033), the calibration key (PRV-071), and
    `estimateTokens` staying in providers, with an Open entry for P1-T18's plan.
  - **ARCH-133, spec fix**: it said adapters have "a `kind`", but the normative
    `ProviderAdapter` has no such field; its optional members are its kinds. Reworded
    to match the code block.
  - **PRV-081, spec fix**: the fixture number counts that role's calls only, because
    background and interactive calls interleave. Recorded in 05-providers' Decisions,
    as planned, and also reworded in place (OVR-034: amend, don't annotate), a small
    deviation from the plan, which named only the Decisions row.
  - **`TokenUsage.inputTokens` counts the whole prompt**, cached tokens included.
    Recorded in 05-providers' Decisions, with a new **Traps** section for P1-T11 and
    P1-T12: Anthropic's `input_tokens` and Ollama's `prompt_eval_count` may leave out
    cached tokens.
  - **Open, 05-providers**: the mock's embeddings cannot be scripted or recorded until
    phase 4.
  - **Design-note defects**: `calibrate` takes the profile, not `profileId`, since the
    key needs its model; the delay comes after each word, as PRV-083 says, not between
    words; and the registry has a `comfyui` case, since `ProviderConfig` has one and
    the switch is exhaustive.
  - **Extra files** (CONV-132): `mock-outputs.ts`, `mock-fixtures.ts`, the fixtures,
    `scripts/check-spec.ts` with its test and README, `.prettierignore` (the copy is
    never reformatted, like the contracts), and one line in `apps/server/README.md`
    pointing at the fixtures.
  - **Smaller calls**:
    - `defaultOutcome` takes the placeholder table as a parameter, so the known-schema
      test passes a one-entry table while phase 1's is empty.
    - A call with no text, or no `onDelta`, pauses once, and so does `embed`. An abort
      during the pause after the last word is still `cancelled`, with all the text.
    - A cancelled result's usage is estimated from the prompt and the text sent, at 4
      characters per token. `mockResponse` reports `inputTokens: 0` unless given.
    - The calibration key is `<profileId>:<model>`; IDs are slugs, so the first colon
      splits it. The average is computed as `current + 0.2 × (sample − current)`, the
      same as `0.8 × current + 0.2 × sample` but exact when the sample agrees.
    - A corrupt `calibration.json` is replaced by the next save; `problem` says so
      first, for the composition root to log.
    - `index.ts` also exports `MockProviderConfig`, `Calibration`, and
      `CALIBRATION_FILE`.
- **Pending decisions:** None.
- **Not tested:** None. Every listed requirement has a test named by its ID, CONV-113
  included.
- **Dependencies:** None new: `zod` and `vitest` were already in `apps/server`.
