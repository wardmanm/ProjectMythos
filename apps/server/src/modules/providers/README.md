# providers

Everything between the engine and a model. So far: the adapter interface every provider
implements, the registry that builds an adapter from machine config, the mock adapter
every test uses, the Ollama and OpenAI-compatible adapters and the HTTP helpers they
share, token estimation with its calibration, and the job queue. The Anthropic adapter
(P1-T12) and the structured-output pipeline (P1-T14) arrive later. The adapters import
`config`, for `DataDirEnv` and `resolveSecret`; the queue imports `config`, `storage`,
and `events`. ARCH-021 allows all three.

## Public API (`index.ts`)

- **Types** from `types.ts`, a byte-for-byte copy of the 05-providers §3 code block:
  `ProviderAdapter`, `TextRequest`, `TextResponse`, `ResponseFormat`, and
  `ProviderError`. Never edit it here; `pnpm check` fails if it differs from
  `spec/reference/server-types/providers/types.ts`.
- `createAdapter(config, deps)` builds the adapter for one provider in machine config.
  `deps` is an `AdapterDependencies` from the composition root: `env`, where
  `{ "env": … }` API keys are read, and `timeSource`, which turns an HTTP-date
  `retry-after` into seconds. The adapters still to come throw, naming the task that
  brings them.
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

## Adapter helpers (`adapters/`)

The real adapters share these. None is exported from `index.ts`.

- `sendRequest(request, timeSource)` in `http.ts` sends one request with `fetch` and
  returns once the response headers arrive. `timeoutMs` is an idle timeout: it bounds
  the wait for the headers, then each wait for a body chunk, never the whole call. Every
  failure is the `ProviderError` PRV-013 gives it (`http-errors.ts`); the caller's abort
  is checked before the timeout. Messages name the provider and the server's origin,
  never a header, path, or query string, and quote the provider's own message with any
  `secrets` replaced. A 2xx body is read once, with `chunks()` or `json(schema)`.
- `parseWire(text, schema, provider)` parses a body, or one line or event of a stream,
  with the adapter's Zod wire schema. Anything it cannot read is `provider_unavailable`.
- `resolveApiKey(secret, env)` reads an API key. A missing variable is
  `provider_rejected`.
- `readNdjsonLines(chunks)` and `readSseEvents(chunks)` in `lines.ts` read a streamed
  body line by line, or event by event. `[DONE]` ends an SSE stream.
- `createThinkTagSplitter()` in `think-tags.ts` separates inline `<think>…</think>`
  reasoning from answer text as it streams, holding back a possible partial tag.
- `startFakeServer()` in `fake-server.ts` is for tests only: a `node:http` server on
  127.0.0.1 and port 0 that replies as the test scripts and records each request.
  `testing.ts` builds profiles, requests, each adapter pointed at a fake server, and
  each provider's replies.

## Adapters

The Ollama and OpenAI-compatible adapters behave alike, through `text-output.ts` and
`quick-calls.ts`:

- `generate` streams whenever the request has `onDelta`, and passes it every piece of
  answer text. Sending the whole text as one delta for a profile with `streaming: false`
  (PRV-045) is `streamText`'s job (P1-T14). Thinking never reaches `onDelta`, whether it
  comes in a field of its own or in inline `<think>…</think>` blocks (PRV-046).
- A JSON format uses the profile's `structuredOutput` method; a text format sends none.
  With `tool-call`, the tool's arguments are the answer, and pieces of them stream to
  `onDelta`. A model that answers in plain text instead has that text used.
- Usage comes from the provider; a count it leaves out, and every count for a cancelled
  call, is estimated from the profile's `charsPerToken`.
- An abort after answer text returns that text with `finishReason: 'cancelled'`. An
  abort before any, with only thinking received, or any other failure, however much
  text arrived, is the error (PRV-047).
- `health` and `listModels` make one GET with a 10-second idle timeout. Any error makes
  the provider unreachable, with the error's message as `detail`.
- Neither has an `embedding` member yet.

### Ollama (`ollama.ts`)

Written against Ollama 0.40.14, from these, read on 2026-11-05:

- the [API reference](https://github.com/ollama/ollama/blob/main/docs/api.md):
  `/api/chat`, `/api/tags`, and `/api/version`;
- the [errors page](https://docs.ollama.com/api/errors), for an `error` line inside a
  stream;
- the source, [`api/types.go`](https://github.com/ollama/ollama/blob/main/api/types.go)
  and [`llm/llama_server.go`](https://github.com/ollama/ollama/blob/main/llm/llama_server.go),
  since the docs leave out that `prompt_eval_count` is the whole prompt and
  `prompt_eval_cached_count` the cached part of it.

It sends `options.num_ctx` from the profile's `contextWindow` (PRV-020), `num_predict`
from `maxOutputTokens`, and each sampling value that is set, as `temperature`, `top_p`,
`top_k`, `repeat_penalty`, or `presence_penalty`. `keep_alive` comes from the provider
(PRV-021). `think` is `true` or `false` from the profile, and left out for
`provider-default` (PRV-022). `json-schema` sets `format` to the schema (PRV-023);
`tool-call` offers one tool named after the schema, which Ollama cannot force;
`prompt-only` sends neither. A stream is newline-delimited JSON, whose `done` line holds
`done_reason` and the counts; an `error` line is `provider_unavailable`.

### OpenAI-compatible (`openai-compatible.ts`, `openai-compatible-wire.ts`)

Written against OpenAI's
[Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
read on 2026-11-05, for `response_format`, `tools`, `tool_choice`, and streaming.

It sends `max_tokens`, and each sampling value that is set: `temperature`, `top_p`,
`presence_penalty`, and `top_k` and `repeat_penalty`, which OpenAI lacks but llama.cpp,
vLLM, and LM Studio read. A streamed call adds `stream_options.include_usage`.
`json-schema` sends `response_format` with the schema and `strict: true`; `tool-call`
sends one tool and forces it with `tool_choice`; `prompt-only` sends neither (PRV-030).
No thinking parameter is sent. The configured `headers` go as they are; an `apiKey` is
sent as a bearer token, in place of any `Authorization` header. Messages call the
provider by its ID: "lm-studio (OpenAI-compatible)".

`reasoning_content` and `reasoning` are thinking. A `refusal`, or `finish_reason:
'content_filter'`, is `ok` with `finishReason: 'refusal'`, whose text is the answer, or
the refusal's own words when there is none. `prompt_tokens` is the whole prompt and
`cached_tokens` its cached part. An `error` field, or an SSE `error` event, in a 200
reply is `provider_unavailable`.

## Calibration

`<dataDir>/calibration.json` holds one ratio per profile and model, keyed
`<profileId>:<model>`, with its sample count. Each call moves the ratio a fifth of the
way toward `current × estimated / reported`. Changing a profile's model starts again
from the profile's own `charsPerToken`. Writes are atomic and one at a time. A corrupt
file is replaced on the next save.

## Job queue

Every model call runs as a job (05-providers §6). `createJobQueue(options)` is called
once, by the composition root (ARCH-022), with:

- `config`: the `ConfigStore`. Each scheduling decision reads `current()` once, so device
  concurrency, `queue.preemptBackground`, and `queue.maxAttempts` apply without a
  restart (PRV-004). A device missing from the config, and every device while the config
  fails to load, runs one job at a time.
- `campaigns`: the campaign store's `openCampaign` and `listCampaigns`. Background jobs
  are rows in their campaign's `jobs` table, written through storage's jobs repository.
  The queue opens the campaign for each write and holds no connection.
- `publish`: the event bus's `publish`, for `job.updated`.
- `timeSource`, `logger` (pino's fits `QueueLogger`), and `setTimer`, the backoff timer:
  `(ms, callback) => cancel`. In production it wraps `setTimeout`:
  `(ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); }`.

It returns the copied `JobQueue` and `JobQueueLifecycle`:

- `register(handler)`, at startup, for persisted background job types only. It throws for
  a type registered twice, the reserved type `interactive`, `persisted: false`, or
  priority `interactive`. A handler's optional `onFailed(payload, error)` runs once when
  its job ends `failed`.
- `enqueue(options)` throws for an unknown type, or a payload that is not JSON or fails
  the handler's schema (PRV-066). For a campaign that does not exist it returns
  `not_found`. Otherwise it stores the job as `queued`.
- `runInteractive(options, work)` runs `work` in a slot on its device at `interactive`
  priority, never stored, as a job of type `interactive`. It resolves with whatever the
  last run of `work` returned, partial narration included (PRV-047), or `cancelled` if it
  was cancelled before it ran. With `campaignId: null` it publishes nothing (PRV-092).
- `cancel(jobId)` ends a queued job at once, clearing any backoff timer. A running job
  has its signal aborted and ends `cancelled` when its run settles, with no retry.
- `wait(jobId)` resolves with `ok`, the last error, or `cancelled`. The queue forgets a
  job once it finishes, so a job it does not hold, finished or never known, gives
  `not_found` at once.
- `resume()`, at server start, after every `register`: takes back each campaign's
  `queued` and `running` jobs, in stored order (PRV-062). A stored job with no handler,
  or whose payload no longer parses, is marked `failed`; a campaign that fails to open
  is logged and skipped. Before a campaign's first new job, `enqueue` takes back its
  stored jobs too, once per campaign.
- `stop()`, at shutdown, before `closeAll()`: cancels interactive jobs, aborts running
  background jobs and stores them as `queued`, and resolves once every run has settled.
  Whoever waits on a background job gets `cancelled`. Afterwards `enqueue`,
  `runInteractive`, and `resume` throw.

How jobs run:

- **Order** (PRV-060): each device runs up to its `concurrency` jobs, highest priority
  first (ARCH-080), then in arrival order. A retried or preempted job keeps its place.
  Each change (a job added, a run settling, a timer, a cancel) asks for one scheduling
  pass, run in a microtask; nothing polls.
- **Retries** (PRV-051, PRV-063): an error the run returns with `retryable: true`, as a
  `ProviderError` has (PRV-013), is retried after 2 s, 8 s, then 30 s each time, or after
  `details.retryAfterSeconds` if that is longer, until `queue.maxAttempts`. The job is
  `queued` while it waits. Any other error fails the job. A run that throws fails it as
  `internal_error`, and is logged. Interactive work is retried the same way.
- **Attempts**: `attempts` counts runs that ended in success or failure, and
  `ctx.attempt` is `attempts + 1`. Runs that were preempted, stopped, cut off by a
  restart, or cancelled do not count.
- **Preemption** (PRV-064): with `preemptBackground` on, an interactive job that finds
  every slot on its device running a background job aborts the one started last. That
  job goes back to `queued` when its run settles, and only then does the slot free. A
  handler, and the work given to `runInteractive`, must pass `ctx.signal` to every call
  and return soon after it aborts.
- **Events** (PRV-065): every status change is written to storage first, then published
  as `job.updated` on the job's campaign.

## Files

- `types.ts`: the copied interface types.
- `registry.ts`: `createAdapter` and `AdapterDependencies`.
- `mock-adapter.ts`: the mock's modes, streaming, delays, and aborts.
- `mock-outputs.ts`: placeholders, embeddings, `mockResponse`, `mockProviderError`.
- `mock-fixtures.ts`: fixture names, reading, and the strict `TextResponse` schema.
- `tokens.ts`: `estimateTokens` and calibration.
- `queue.ts`: the 05-providers §6 types, copied verbatim above its divider line (never
  edit them here), then `createJobQueue`: registering, enqueueing, interactive jobs, and
  taking back stored jobs.
- `queue-runner.ts`: the scheduling pass, each run and what follows it, cancel, and stop.
- `queue-policy.ts`: the pure decisions: settings from config, the pass plan with
  preemption, retryability, and the backoff.
- `queue-persistence.ts`: binding payloads to handlers, reading stored jobs, and the
  recorder that stores each change and then publishes it.
- `queue-testing.ts`: the queue tests' helpers (a fake timer, held runs, an editable
  config, campaigns in temporary folders). Not exported.
- `adapters/http.ts`: `sendRequest`, `parseWire`, `resolveApiKey`, and
  `RateLimitDetailsSchema`.
- `adapters/http-errors.ts`: the PRV-013 error mapping, messages, and `retry-after`.
- `adapters/lines.ts`: the NDJSON and SSE readers.
- `adapters/think-tags.ts`: the `<think>` splitter.
- `adapters/fake-server.ts`: the fake provider server adapter tests use.
- `adapters/ollama.ts`: the Ollama adapter and its wire schemas.
- `adapters/openai-compatible.ts` and `openai-compatible-wire.ts`: the
  OpenAI-compatible adapter, and its wire schemas and request type.
- `adapters/text-output.ts`: answer, thinking, and tool arguments as they arrive, and
  the finished or failed `TextResponse`.
- `adapters/quick-calls.ts`: the GET behind `health` and `listModels`.
- `adapters/testing.ts`: builders for the adapters' tests.

## Governing spec

- [05-providers.md](../../../../../spec/05-providers.md) §3, §4, §6, §7, §8, and its
  closing sections.
- [01-architecture.md](../../../../../spec/01-architecture.md): ARCH-080 to ARCH-083
  (§6.1), ARCH-131, and ARCH-133.
- [06-turn-engine.md](../../../../../spec/06-turn-engine.md): TRN-012, resuming
  background jobs on server start.
- [02-conventions.md](../../../../../spec/02-conventions.md): CONV-113 and CONV-114.
- [ADR-010](../../../../../spec/decisions/ADR-010-no-vendor-sdks.md): adapters use
  `fetch`, not vendor SDKs.
