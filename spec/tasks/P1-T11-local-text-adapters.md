# P1-T11: Ollama and OpenAI-compatible adapters

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T10 |
| **Branch** | `p1-t11-local-text-adapters` |

## Goal

Talk to the two local-first text APIs. Ollama's native chat API: streamed and
non-streamed text, JSON-schema output, thinking control, context size, and keep-alive.
OpenAI-compatible servers (LM Studio, llama.cpp, vLLM, OpenRouter): chat completions with
streaming, the three structured-output methods, and reasoning text.

## Read

- `spec/05-providers.md` §3 (PRV-010 to PRV-013, PRV-020 to PRV-023, PRV-030, PRV-031), §4 (PRV-045 to PRV-047)
- Ollama's current API documentation for `/api/chat`, `/api/tags`, and `/api/version` (PRV-042)
- The OpenAI Chat Completions API reference for `response_format`, `tools`, `tool_choice`, and streaming (PRV-042)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

PRV-010, PRV-011, PRV-012, PRV-013, PRV-020, PRV-021, PRV-022, PRV-023, PRV-030, PRV-045, PRV-046, PRV-047

## Outputs

- `apps/server/src/modules/providers/adapters/ollama.ts` and `ollama.test.ts`
- `apps/server/src/modules/providers/adapters/openai-compatible.ts` and `openai-compatible.test.ts`
- Registry cases for `ollama` and `openai-compatible`
- Providers `README.md` sections for both

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other providers files except the registry

## Design notes

- **Both adapters.** Build Ollama first; the OpenAI-compatible adapter follows its shape.
  - Tests run against fake servers created with `node:http` inside the test, on a
    random local port. No test touches a real model (CONV-113).
  - Map errors exactly as PRV-013.
  - Abort as PRV-047: once text has arrived, return `ok` with the text so far and
    `finishReason: 'cancelled'`; otherwise return the `cancelled` error.
- **Ollama.**
  - `options.num_ctx` comes from `profile.contextWindow` (PRV-020), and `keep_alive` from
    the provider config (PRV-021).
  - `think` is true or false from `profile.thinking`; omit it for `provider-default`.
  - `format` is set to the JSON Schema for the `json-schema` method.
  - Streaming is newline-delimited JSON. Separate thinking from answer text, both from
    the `thinking` field and from inline `<think>…</think>` blocks (PRV-046), including
    a tag split across two chunks.
- **OpenAI-compatible.**
  - The three structured-output methods (PRV-030):
    - `json-schema` sends `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`;
    - `tool-call` sends one tool with the schema as its parameters, forces it with
      `tool_choice`, and reads the answer from the tool call's arguments;
    - `prompt-only` sends no format parameter.
  - Streaming is SSE with `data:` lines and a final `[DONE]`. Some servers send
    reasoning in `reasoning_content` or `reasoning`, others in inline `<think>` tags:
    capture all three as thinking (PRV-046).
  - The API key is optional (local servers need none) and is sent as a bearer token
    when configured. Never log it.

## Acceptance

- [x] For each adapter, a recorded request body for each structured-output method matches its snapshot, and for Ollama each thinking setting does too. The `tool-call` answer is read from the tool arguments.
- [x] PRV-046: a `<think>` tag split across chunks never leaks into `onDelta` text, and OpenAI-compatible reasoning in all three forms is separated from answer text, streamed and not.
- [x] PRV-013, for both adapters: refused connection, timeout, 429 with `retry-after`, 500, 400, and abort each map to the right code and `retryable` flag.
- [x] `listModels` and `health` work against both fake servers.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - Stage 1 (`8d60250`, which P1-T12 builds on): `createAdapter(config, deps)` with
    `AdapterDependencies` (`env`, `timeSource`), exported from `index.ts`, and the
    shared helpers in `apps/server/src/modules/providers/adapters/`: `http.ts`
    (`sendRequest` with an idle `timeoutMs`, `parseWire`, `resolveApiKey`,
    `RateLimitDetailsSchema`), `http-errors.ts` (the PRV-013 mapping), `lines.ts`
    (NDJSON and SSE readers), `think-tags.ts`, and the test-only `fake-server.ts`.
  - Stage 2: `ollama.ts`; `openai-compatible.ts` with `openai-compatible-wire.ts`;
    `text-output.ts` (answer, thinking, and tool arguments as they arrive; the finished
    or failed `TextResponse`); `quick-calls.ts` (the GET behind `health` and
    `listModels`); `streamError` in `http-errors.ts`; the test-only `testing.ts`; the
    registry cases; and the providers README's Adapters section, which links the
    Ollama and OpenAI documentation used, read on 2026-11-05.
  - 154 adapter tests in ten files, and the registry test. Acceptance, by test:
    - request bodies: inline snapshots in `ollama-request.test.ts` (text, each method,
      each thinking setting) and `openai-compatible-request.test.ts` (text, each
      method, a streamed call); the tool-call answer in `PRV-023: tool-call reads the
      answer from the tool call arguments` and `PRV-030: tool-call reads the answer
      from the tool call arguments`;
    - PRV-046: `a <think> block split across lines never reaches onDelta` (Ollama), and
      `reasoning in %s is thinking, never answer text, when streamed` and `… when not
      streamed`, each over `reasoning_content`, `reasoning`, and inline tags;
    - PRV-013 and PRV-047: `errors.test.ts` runs the same eleven cases against both
      adapters: refused, timeout before and during a stream, 429, 500, 400, an error
      inside a 200 stream, an unreadable reply, a dropped connection after text, and
      aborts before text, after text, and with only thinking;
    - PRV-091: listModels and health for both, healthy and not.
  - Ollama's usage was confirmed in its source, not only its documentation:
    `prompt_eval_count` is `cache_n + prompt_n` (`llm/llama_server.go`), so it is the
    whole prompt, and `prompt_eval_cached_count` is the cached part.
  - Verified, then reverted: with the cancelled and timed-out checks swapped in
    `http.ts`, `PRV-013, PRV-047: an abort at the moment of a timeout is cancelled`
    fails.
  - `pnpm check` passes after rebasing onto `main` with P1-T13 and P1-T17 merged
    (`939dd86`). The workspace has `Tests  787 passed (787)` and `spec/reference`
    `Tests  271 passed (271)`, and it ends with `Docs check passed: 834 requirements, 25
    tasks (15 done), 20 ADRs, 83 markdown files, 1019 citations in code.`
- **Rulings:**
  - **Owner's decisions** (`P1-T11: spec: owner: idle timeouts, estimated usage, and
    Ollama's tool-call fallback`): PRV-013 says `timeoutMs` is idle time, the wait for
    the headers and then for each body chunk; three Decisions rows in 05-providers
    (idle timeouts in every adapter, estimated usage, Ollama's tool-call fallback to
    plain text); and an Open bullet: P1-T14 skips calibration on cancelled calls.
  - **PRV-013, spec fix**: `retry-after` travels as `details.retryAfterSeconds`; an
    error inside a 200 response is `provider_unavailable`; a refusal in a 200 response
    is `ok` with `finishReason: 'refusal'` (CSET-050), and only one sent as a 4xx is
    `provider_rejected`.
  - **CONV-113, spec fix**: an adapter's own tests call a fake HTTP server on
    `127.0.0.1` and a port the OS picks.
  - **Traps, 05-providers**: the `inputTokens` paragraph now records what Ollama 0.40.14
    and OpenAI report; Anthropic is left for P1-T12.
  - **Decisions, 05-providers**, fifteen `Claude (ruling)` rows:
    - from stage 1: an unreadable 200 reply is `provider_unavailable` (PRV-012,
      PRV-013); `httpStatus` only when the status caused the error; Node's network
      codes, and headers `fetch` would refuse caught before sending; how `retry-after`
      is read; API keys are trimmed (PRV-005); the `<think>` splitter's edge cases
      (PRV-046);
    - from stage 2: the method comes from `profile.structuredOutput`, and a text
      format sends none (PRV-023, PRV-030); an adapter streams whenever `onDelta` is
      given (PRV-045); a 200 refusal is `finishReason: 'refusal'`; only an abort keeps
      partial text (PRV-047); what the OpenAI-compatible adapter sends (PRV-030); its
      tool-call fallback to content; a stream that ends cleanly is complete (PRV-012);
      adapters take no logger (CONV-070); `health` and `listModels` use one GET with a
      10-second idle timeout (PRV-091).
  - **Open, 05-providers**: a stray `</think>` cannot take back reasoning already
    streamed; the OpenAI-compatible adapter sends no thinking parameter; neither local
    adapter has an `embedding` member until phase 4.
  - **Extra files** (CONV-132): the helpers above (`http.ts`, `http-errors.ts`,
    `lines.ts`, `think-tags.ts`, `text-output.ts`, `quick-calls.ts`,
    `openai-compatible-wire.ts`), the test-only `fake-server.ts` and `testing.ts`, and
    their tests, `errors.test.ts` and the two `*-request.test.ts` files among them;
    `providers/index.ts` (exports `AdapterDependencies`); `mock-fixtures.test.ts`
    (passes `deps`); `spec/02-conventions.md` (CONV-113).
  - **Smaller calls**:
    - Request bodies are inline snapshots of what the fake server recorded.
    - Error messages call the providers "Ollama" and "<id> (OpenAI-compatible)", and
      name only the server's origin, never a path, query string, header, or password.
    - PRV-042 stays where it is, under Anthropic: the README links every adapter's
      documentation with its date, and rewording PRV-042 would touch the line next to
      P1-T12's PRV-043.
    - Ollama's `options` carry `num_predict` from `maxOutputTokens`; `cacheBreakpoint`
      is dropped from the messages both adapters send.
    - With `tool-call`, only the first tool call counts, and pieces of its arguments
      go to `onDelta`, since they are the answer.
    - An OpenAI-compatible reply with an `error` field, or with no choices, is
      `provider_unavailable`; an `apiKey` replaces any `Authorization` in `headers`.
- **Pending decisions:** None.
- **Not tested:**
  - PRV-010: only the Ollama and OpenAI-compatible adapters are tested here; the
    Anthropic adapter is P1-T12's, and the media members arrive in phases 9 and 10.
  - PRV-045: the adapters pass every delta to `onDelta`, as tested; the
    `narration.delta` events and the one-delta fallback for `streaming: false` belong
    to `streamText` (P1-T14).
  - PRV-047: an aborted adapter call returns its text or the `cancelled` error, as
    tested; committing the partial narration as incomplete belongs to P1-T14 and P1-T19.
- **Dependencies:** None new: the adapters use Node's built-in `fetch`, and the tests
  `node:http`.
