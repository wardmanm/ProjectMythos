# providers

Everything between the engine and a model. So far: the adapter interface every provider
implements, the registry that builds an adapter from machine config, the mock adapter
every test uses, and token estimation with its calibration. The real adapters (P1-T11,
P1-T12), the job queue (P1-T13), and the structured-output pipeline (P1-T14) arrive
later. It imports no other module yet; ARCH-021 allows `config`, `storage`, and `events`.

## Public API (`index.ts`)

- **Types** from `types.ts`, a byte-for-byte copy of the 05-providers §3 code block:
  `ProviderAdapter`, `TextRequest`, `TextResponse`, `ResponseFormat`, and
  `ProviderError`. Never edit it here; `pnpm check` fails if it differs from
  `spec/reference/server-types/providers/types.ts`.
- `createAdapter(config)` builds the adapter for one provider in machine config. The
  real adapters throw, naming the task that brings them, until they arrive.
- `createMockAdapter(config)` builds the mock directly, as a `MockAdapter`, whose
  `text` and `embedding` members are always there. A test can:
  - `script(role, ...outcomes)` to queue each call's `MockOutcome`: a response, or an
    error with optional `partialText` streamed first;
  - read `requests`, every `TextRequest` received, in order.
- `mockResponse(text, overrides)` and `mockProviderError(code, message)` build outcomes.
  Each error has the `retryable` and `httpStatus` PRV-013 gives its code.
- `estimateTokens(text, charsPerToken)` is `ceil(length / ratio)`, with no margin.
- `openCalibration(dataDir)` returns `{ calibration, problem }`. The composition root
  opens it once and logs `problem` if the file was corrupt. A `Calibration` has:
  - `charsPerToken(profile)`, the ratio to estimate with;
  - `calibrate(profile, estimated, reported)`, which folds one call into it.

## The mock

A call is answered in one of three modes:

- **Scripted**, once a test has called `script`: each call takes the next outcome
  queued for its role. An empty queue throws, naming the role and the call.
- **Fixture**, when `fixturesDir` is set: each call reads
  `<fixturesDir>/<seq>-<role>.json`, where `seq` counts that role's calls from `001`.
  [The fixture README](../../../test/fixtures/model/README.md) has the layout.
- **Default**, otherwise: short placeholder text for the role, or the placeholder in
  `jsonPlaceholders` for a JSON schema. An unknown schema is `provider_rejected`.

In every mode the text streams to `onDelta` a word at a time, with a pause of `delayMs`
after each word. A call that is not streamed, or has no text, pauses once. Thinking is
never streamed. An abort after some text returns that text, with `finishReason` set to
`'cancelled'`; an abort before any returns the `cancelled` error. The pauses use the
global `setTimeout`, so Vitest's fake timers control them. `embed` returns
deterministic unit vectors of the profile's `embeddingDimensions`. The mock never calls
`fetch`.

## Calibration

`<dataDir>/calibration.json` holds one ratio per profile and model, keyed
`<profileId>:<model>`, with its sample count. Each call moves the ratio a fifth of the
way toward `current × estimated / reported`. Changing a profile's model starts again
from the profile's own `charsPerToken`. Writes are atomic and one at a time. A corrupt
file is replaced on the next save.

## Files

- `types.ts`: the copied interface types.
- `registry.ts`: `createAdapter`.
- `mock-adapter.ts`: the mock's modes, streaming, delays, and aborts.
- `mock-outputs.ts`: placeholders, embeddings, `mockResponse`, `mockProviderError`.
- `mock-fixtures.ts`: fixture names, reading, and the strict `TextResponse` schema.
- `tokens.ts`: `estimateTokens` and calibration.

## Governing spec

- [05-providers.md](../../../../../spec/05-providers.md) §3, §4, §7, §8, and its
  closing sections.
- [01-architecture.md](../../../../../spec/01-architecture.md): ARCH-133.
- [02-conventions.md](../../../../../spec/02-conventions.md): CONV-113 and CONV-114.
- [ADR-010](../../../../../spec/decisions/ADR-010-no-vendor-sdks.md): adapters use
  `fetch`, not vendor SDKs.
