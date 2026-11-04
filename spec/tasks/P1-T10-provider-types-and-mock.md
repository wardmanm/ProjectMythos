# P1-T10: Provider types, mock adapter, token estimation

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] PRV-084: each `ProviderError` code can be produced by the mock and has a test.
- [ ] PRV-081: fixture mode replays a recorded sequence by test name, role, and sequence number.
- [ ] PRV-071: calibration converges toward a constant ratio within ten calls and survives a reload.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
