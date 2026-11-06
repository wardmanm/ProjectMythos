# providers

Everything between the engine and a model: the adapter interface every provider
implements, the registry that builds an adapter from machine config, the mock adapter
every test uses, the Ollama, OpenAI-compatible, and Anthropic adapters and the HTTP
helpers they share, token estimation with its calibration, the job queue, the model
calls every other module makes, `callStructured` and `streamText`, and the settings
screen's probe and provider statuses. The adapters import
`config`, for `DataDirEnv` and `resolveSecret`; the queue imports `config`, `storage`,
and `events`, and the model calls `config` and `storage`. ARCH-021 allows all three.

## Public API (`index.ts`)

- **Types** from `types.ts`, a byte-for-byte copy of the 05-providers §3 code block:
  `ProviderAdapter`, `TextRequest`, `TextResponse`, `ResponseFormat`, and
  `ProviderError`. Never edit it here; `pnpm check` fails if it differs from
  `spec/reference/server-types/providers/types.ts`.
- `createAdapter(config, deps)` builds the adapter for one provider in machine config.
  `deps` is an `AdapterDependencies` from the composition root: `env`, where
  `{ "env": … }` API keys are read, and `timeSource`, which turns an HTTP-date
  `retry-after` into seconds. It builds the mock and the three text adapters; `comfyui`
  throws, naming the phase that brings it.
- `createMockAdapter(config)` builds the mock directly, as a `MockAdapter`, whose
  `text` and `embedding` members are always there. A test can:
  - `script(role, ...outcomes)` to queue each call's `MockOutcome`: a response, or an
    error with optional `partialText` streamed first;
  - read `requests`, every `TextRequest` received, in order.
- `mockResponse(text, overrides)` and `mockProviderError(code, message)` build outcomes.
  Each error has the `retryable` and `httpStatus` PRV-013 gives its code.
- `estimateTokens(text, charsPerToken)` is `ceil(length / ratio)`, with no margin. It lives
  in `core`, so the context module counts alike, and `tokens.ts` re-exports it.
- `openCalibration(dataDir)` returns `{ calibration, problem }`. The composition root
  opens it once and logs `problem` if the file was corrupt. A `Calibration` has:
  - `charsPerToken(profile)`, the ratio to estimate with;
  - `calibrate(profile, estimated, reported)`, which folds one call into it.
- `createModelCalls(options)` returns `{ callStructured, streamText }` (see
  [Model calls](#model-calls)), with their types from `structured.ts`:
  `StructuredCallOptions`, `CallStructured`, `StreamTextOptions`, `StreamText`,
  `StreamedText`, and `PromptReport`.
- `routeRole(config, role)` gives a role's `RoleRoute`: its profile, provider, and
  sampling, or `not_configured`. The composition root can give it to the context module
  too (CTX-110).
- `toJsonSchema(schema)` and `adaptSchema(jsonSchema, providerType, method)` are steps 1
  and 2 of the pipeline, which the probe uses too (PRV-092).
- `createProbe(options)` returns `{ probe }`, with its types `ProbeOptions` and
  `ProviderProbe`, and `createHealthCheck(options)` returns `{ statuses }`, with
  `HealthCheckOptions`, `HealthCheck`, `ProviderStatus`, and `HEALTH_TIMEOUT_MS` (see
  [Probe and health](#probe-and-health)).

## The mock

A call is answered in one of three modes:

- **Scripted**, once a test has called `script`: each call takes the next outcome
  queued for its role. An empty queue throws, naming the role and the call.
- **Fixture**, when `fixturesDir` is set: each call reads
  `<fixturesDir>/<seq>-<role>.json`, where `seq` counts that role's calls from `001`.
  [The fixture README](../../../test/fixtures/model/README.md) has the layout.
- **Default**, otherwise: short placeholder text for the role, or the placeholder in
  `jsonPlaceholders` for a JSON schema. An unknown schema is `provider_rejected`. In
  phase 1 the table holds only the probe's schema, so an unscripted mock profile passes
  every method when probed.

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

## The Anthropic adapter

`adapters/anthropic.ts` talks to the Messages API with `fetch` through `sendRequest`,
never the SDK (ADR-010). It has `text` and no `embedding`. Written against these pages
of Anthropic's documentation, all read on 2026-11-05 (PRV-042):

- [Messages](https://platform.claude.com/docs/en/api/messages),
  [streaming](https://platform.claude.com/docs/en/build-with-claude/streaming), and
  [errors](https://platform.claude.com/docs/en/api/errors);
- [prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching);
- [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
  and [strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use);
- [thinking](https://platform.claude.com/docs/en/build-with-claude/thinking);
- [listing models](https://platform.claude.com/docs/en/api/models/list);
- [version 2026-10-21](https://platform.claude.com/docs/en/api/migration-2026-10-21).

**The request** (`anthropic-request.ts`, pure) is `POST {baseUrl}/v1/messages`. `baseUrl`
is the API's origin without `/v1`, `https://api.anthropic.com` by default. Each request
sends:

- the key in `x-api-key` and `anthropic-version: 2026-10-21`. Anthropic's newer SDKs send
  the key as `Authorization: Bearer` instead; the API accepts both;
- the leading system messages as `system` text blocks, and the rest as messages, with
  consecutive same-role messages merged into one message with one block each (PRV-043,
  CTX-011);
- `cache_control: { type: 'ephemeral' }` on each block whose message has
  `cacheBreakpoint`, and nowhere else (PRV-041). A message with no visible text is left
  out, and its breakpoint moves to the block before it. A system message after the
  conversation began, or more than four breakpoints, throws;
- `stream: true`, always, so one parser reads every response;
- `thinking` from the profile: `off` is `{ type: 'disabled' }`, `on` is
  `{ type: 'adaptive', display: 'summarized' }`, and `provider-default` leaves it out.
  Without `display: 'summarized'`, current models stream empty thinking.

Anthropic ignores the profile's and the role's sampling settings: version 2026-10-21
rejects `temperature`, `top_p`, and `top_k` on every model, so none is sent.

**Structured output.** For a JSON format, the profile's `structuredOutput` picks the
method. The schema arrives already adapted by the pipeline (PRV-052) and is sent as it is.

- `json-schema` uses the native JSON outputs, `output_config.format` with
  `type: 'json_schema'`: generally available, with no beta header. The JSON comes back in
  the text block. The older `output_format` parameter is deprecated and not used.
- `tool-call` sends one tool named after the schema, with `strict: true`, and forces it
  with `tool_choice: { type: 'tool', name }`. The answer is that tool's input. Claude Opus
  5.5, Sonnet 5.5, Fable 5.1, and Mythos 5.1 refuse forced tool use with a 400, which is
  `provider_rejected`, so the pipeline falls back (PRV-053).
- `prompt-only` sends neither.

**The response** (`anthropic-stream.ts`) is read event by event. Text deltas go to
`onDelta` as they arrive and make up `text`; thinking deltas make up `thinking`, never
sent to `onDelta` (PRV-046). Signatures and `redacted_thinking` blocks are dropped, and
empty thinking is `null`. Unknown events, such as `ping`, are skipped; a delta type the
documentation does not list is an unreadable response, since it might carry text.

- **Usage:** `inputTokens` is the whole prompt, the sum of `input_tokens`,
  `cache_read_input_tokens`, and `cache_creation_input_tokens`, and `cachedInputTokens` is
  `cache_read_input_tokens`. The latest count reported wins. A call cancelled before its
  `message_delta` estimates its output tokens from the profile's `charsPerToken`.
- **`finishReason`:** `max_tokens` and `model_context_window_exceeded` are `length`;
  `refusal` is `refusal`, returned as a response; every other reason is `stop`.
- **Errors:** an HTTP failure is mapped by `sendRequest`. A 400 on a profile whose
  thinking is `off` adds that some models cannot turn thinking off, and to set the
  profile's thinking to `provider-default`. An `error` event in the stream is mapped by its
  `error.type`: overloaded and internal errors are `provider_unavailable`, a rate limit is
  `rate_limited`, a timeout is `provider_timeout`, and anything else is
  `provider_rejected`. It is an error even after text has arrived, and so is a body that
  ends before `message_stop`. Only an abort keeps partial text (PRV-047).

`listModels` reads `GET /v1/models` 1000 at a time, following `after_id`, in the API's
order. `health` lists one model and times the round trip. A key Anthropic refuses, with a
401 or 403, is unreachable, with a message that says to check it.

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

## Model calls

No module calls an adapter for a model's answer: it calls `callStructured` or
`streamText` (05-providers §5), except the probe (PRV-092). `createModelCalls(options)` is
called once, by the composition root, with:

- `config`, the `ConfigStore`, read once per call (PRV-004);
- `queue`, for `runInteractive` and `cancel`;
- `adapterFor(provider)`, which in production is `createAdapter(provider, deps)`, and in
  tests returns one mock;
- `campaigns` (`openCampaign`), where records are stored; `calibration`; `timeSource`;
  and `logger`.

**Every call** starts by routing its role (`routeRole`, PRV-001). An unassigned role is
`not_configured`. `npc-voice` uses the narrator's assignment and `speech-segmenter` the
extractor's; the role's `sampling` overrides the profile's key by key. A call that fails
here reached no model and has no record. Then each adapter call runs:

- with `job: null`, as an interactive job on the provider's device (`runInteractive`).
  Aborting the caller's `signal` calls `cancel(jobId)`, which aborts the signal the
  adapter call runs under (PRV-061);
- with a `JobContext`, in that job's own slot, under both signals, starting no job of its
  own (PRV-067).

Each run is an attempt, so the queue's transient retries (PRV-051) are recorded too.
Each attempt the provider answered, unless cancelled, calibrates the profile from
`estimateTokens` over the message text sent and the reported `inputTokens` (PRV-071),
without waiting for the save. When the call ends, one `ModelCallRecord` is written to
the campaign's `model_calls` (ARCH-060), not as a commit (ARCH-061). It holds every
attempt, a provider failure in its `error`, the messages of the last request sent, and
the caller's `PromptReport`. A campaign that no longer opens is logged, and the result
still returned. Outcomes: `success`; `fallback`, which means it succeeded after PRV-053's
switch; `failed`; and `cancelled`.

**`callStructured(options)`** runs PRV-050's steps:

1. `toJsonSchema` converts the Zod schema once per schema object (`schema-adapt.ts`). A
   schema that cannot convert, such as one with a transform, throws (CON-004).
2. `adaptSchema` closes every object and removes what Anthropic refuses, for Anthropic's
   `json-schema` and `tool-call` only (PRV-052). Every other case gets the schema as it
   is.
3. The format instruction (`structured-output.ts`) is a system message right after the
   leading system messages. For `json-schema` and `tool-call` it is one line; for
   `prompt-only` it holds the unadapted schema and a minimal example built from it.
4. The answer text has code fences stripped. The text from the first `{` to the last `}`
   is parsed, then repaired with `jsonrepair` if that fails. It is then parsed with the
   schema, issues listed as `path: message`, and checked with `semanticCheck`.
5. A problem is fed back: the answer goes back as the assistant's message, followed by a
   user message listing every problem, for at most two retries. After that the call
   returns `model_output_invalid`, with each attempt's problems in `details.attempts`.

A `provider_rejected` on `json-schema` or `tool-call` is retried once as `prompt-only`,
sending the request with a copy of the profile (PRV-053). This is not a validation
retry. Other errors are returned as they are. An answer cut off by a cancel is
`cancelled`. A refusal is `provider_rejected`, with no retry, and leaves the model's
words out of the message (CSET-050). Only a value that passed the schema and
`semanticCheck` is ever returned (CONV-032).

**`streamText(options)`** sends plain text, such as narration:

- **Streaming:** a profile with `streaming: true` gets each delta forwarded to `onDelta`
  as it arrives. One with streaming off gets the returned text, partial text included, as
  one delta (PRV-045). Adapters keep thinking out of the deltas (PRV-046).
- **Errors:** an error after any delta reached `onDelta` comes back with `retryable:
false`, so the queue never streams the text twice.
- **Cancel:** a cancel returns `{ text, finishReason: 'cancelled' }` with the text so
  far (PRV-047). A refusal is returned as `ok` with `finishReason: 'refusal'` and
  recorded as `failed`.

## Probe and health

The settings screen's two checks (05-providers §9). The composition root builds each
once.

**`createProbe(options)`** takes `config`, `queue` (`runInteractive` and `cancel`),
`adapterFor`, and `timeSource`. It has no campaigns, calibration, or logger, so it
records nothing (PRV-092). `probe(profileId, signal)` returns a `ProbeResult`, or
`not_found` for a profile that is not in machine config, the config's own error when it
fails to load, and `cancelled` once `signal` aborts. In order:

1. **The model list**, `listModels`, called directly: a GET, which needs no slot on the
   device. It sets `reachable`, and `modelPresent` if the model is listed; for Ollama a
   name with no tag matches its `:latest`. A failed list ends the probe, with its
   message as the one suggestion. A model that is not listed is a suggestion, and the
   probe goes on. An embedding profile stops here.
2. **One tiny structured request per method**, `json-schema`, `tool-call`, then
   `prompt-only`, each with a copy of the profile set to that method, the schema adapted
   for it (`adaptSchema`), and its format instruction (`structured-output.ts`). The
   answer is checked with `ProbeAnswerSchema`, an object of an inn's name and its rooms,
   and the result goes in `structuredMethods`.
3. **One text request**, last, so the model is already loaded: about 1,000 tokens of
   scene notes, opening with the probe's start time so a server's prompt cache cannot
   reuse an earlier probe's prompt. It streams to an `onDelta` that times the first
   answer delta. Prompt speed is the uncached input tokens over the time to that delta,
   and generation speed the output tokens over the rest. With thinking, which comes
   first, only generation speed is given, over the whole call. A failed text request
   leaves both null.

Every model request runs as an interactive job on the provider's device, with
`campaignId: null` and `role: 'narrator'`, the profile's own sampling and
`maxOutputTokens`, and the hard floor at the end of its instructions (CSET-040). It is
timed inside its job, so time queued does not count. A failure comes back with
`retryable: false`, so the queue never retries it: each method gets one try.
`emittedThinking` is true if any answer had thinking.

`suggestions`, in order: a model that is not listed; each distinct provider error
message, once; the fastest method that gave valid output, against the profile's own,
with ties going to `json-schema`, then `tool-call` (or why none worked); turning thinking
off on the server, when the model thought though the profile says `off`; and a context
window below 8,192 tokens (CTX-032).

**`createHealthCheck(options)`** takes `config`, `adapterFor`, `setTimer`, and `logger`.
`statuses()` checks every provider in machine config at once and returns a
`ProviderStatus` for each, in config order (PRV-091). Each check gets
`HEALTH_TIMEOUT_MS`, 5 seconds, for the whole call, on top of the adapters' 10-second
idle timeout: then its signal is aborted, and the provider is unreachable, "Ollama at
http://localhost:11434 did not answer within 5 seconds." A check that throws, as
building a `comfyui` adapter does until phase 9, is logged as a warning and reported
unreachable.

## Files

- `types.ts`: the copied interface types.
- `registry.ts`: `createAdapter` and `AdapterDependencies`.
- `mock-adapter.ts`: the mock's modes, streaming, delays, and aborts.
- `mock-outputs.ts`: placeholders, embeddings, `mockResponse`, `mockProviderError`.
- `mock-fixtures.ts`: fixture names, reading, and the strict `TextResponse` schema.
- `tokens.ts`: calibration, and `estimateTokens` re-exported from `core`.
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
- `structured.ts`: the 05-providers §5 types, copied verbatim above its divider line
  (never edit them here), then `createModelCalls`, `callStructured`'s loop, and
  `streamText`.
- `model-call.ts`: what both calls share: routing, each adapter call in its job's slot or
  as an interactive job, attempts, calibration, and the record.
- `structured-output.ts`: the pure steps: the format instruction and its example,
  extracting JSON, validation, and retry feedback.
- `schema-adapt.ts`: `toJsonSchema` and `adaptSchema`.
- `role-routing.ts`: `routeRole`.
- `records.ts`: attempts, outcomes, and storing the record.
- `structured-testing.ts`: the model calls' test harness: a real queue and campaign, the
  mock behind every provider, and a calibration that only remembers. Not exported.
- `probe.ts`: `createProbe`: the profile's listing, each request as an interactive job,
  and timing inside the job.
- `probe-prompts.ts`: what the probe sends: the tiny structured request, its schema
  `ProbeAnswerSchema`, and the text prompt of about 1,000 tokens.
- `probe-report.ts`: the pure half: each method's check, the speeds, model names, and the
  suggestions.
- `probe-testing.ts`: the probe tests' harness: a real queue whose campaigns and event bus
  only remember being used, the mock, and fake time. Not exported.
- `health.ts`: `createHealthCheck` and its 5-second limit.
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
- `adapters/anthropic.ts`: the Anthropic adapter: `generate`, `listModels`, and `health`.
- `adapters/anthropic-request.ts`: the request body, from system blocks to thinking.
- `adapters/anthropic-stream.ts`: the stream's event schemas and the fold into a
  `TextResponse`.
- `adapters/anthropic-testing.ts`: the configs, requests, and stream events the Anthropic
  tests share.

## Governing spec

- [05-providers.md](../../../../../spec/05-providers.md) §2.2 (PRV-001), §3 to §9, and
  its closing sections.
- [03-contracts.md](../../../../../spec/03-contracts.md) §14.1: the model call record,
  its attempts, `ChatMessage`, `ProbeResult`, and `ProviderStatus`.
- [01-architecture.md](../../../../../spec/01-architecture.md): ARCH-060 and ARCH-061
  (§4.4, model call records), ARCH-080 to ARCH-083 (§6.1), ARCH-131, and ARCH-133.
- [06-turn-engine.md](../../../../../spec/06-turn-engine.md): TRN-012, resuming
  background jobs on server start.
- [09-context.md](../../../../../spec/09-context.md): CTX-010 and CTX-011, the message
  layout the Anthropic adapter's breakpoints follow, CTX-032, the context window the
  probe warns about, and CTX-090, the records.
- [13-content-settings.md](../../../../../spec/13-content-settings.md): CSET-040, the
  floor at the end of the probe's instructions, CSET-042, the floor the format
  instruction stays ahead of, and CSET-050, refusals.
- [02-conventions.md](../../../../../spec/02-conventions.md): CONV-032, CONV-113, and
  CONV-114.
- [ADR-010](../../../../../spec/decisions/ADR-010-no-vendor-sdks.md): adapters use
  `fetch`, not vendor SDKs.
