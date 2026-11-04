# P1-T11: Ollama and OpenAI-compatible adapters

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] For each adapter, a recorded request body for each structured-output method matches its snapshot, and for Ollama each thinking setting does too. The `tool-call` answer is read from the tool arguments.
- [ ] PRV-046: a `<think>` tag split across chunks never leaks into `onDelta` text, and OpenAI-compatible reasoning in all three forms is separated from answer text, streamed and not.
- [ ] PRV-013, for both adapters: refused connection, timeout, 429 with `retry-after`, 500, 400, and abort each map to the right code and `retryable` flag.
- [ ] `listModels` and `health` work against both fake servers.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
