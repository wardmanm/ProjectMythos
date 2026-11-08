---
doc: 05-providers
title: Mythos — Providers, Model Roles, and the Job Queue
status: draft
schemaVersion: 1
requirementPrefix: PRV
---

# Providers, Model Roles, and the Job Queue

> **For Claude:** code blocks are **normative** and typechecked against `03-contracts.md`.
> `machine-config.ts` belongs in `packages/contracts/src/`. The other blocks belong in
> `apps/server/src/modules/providers/` and define the module's public types.

This document covers everything between the engine and a model: machine config, model
roles and profiles, provider adapters, the structured-output pipeline, streaming,
token estimation, the job queue, model call records, and the mock provider. It does
not cover prompt content or assembly (`09-context.md`).

## 1. Concepts

- A **device** is a physical compute resource (a GPU, or "cloud"). Jobs on one device
  run one at a time by default.
- A **provider** is a configured endpoint (an Ollama server, an Anthropic account) on a
  device.
- A **model profile** is a model on a provider plus everything the engine needs to use
  it well: context window, structured-output method, sampling, token budgets.
- A **model role** is a job in the game (narrator, extractor, …). Each role is assigned
  a profile in machine config.

Two machines with different hardware simply have different machine configs. A
campaign never stores which models it used for future calls (OVR-006), only which
model produced each past output (in model call records).

## 2. Machine config — `machine-config.ts`

```ts
import { z } from 'zod';
import { ModelRoleSchema } from './models';

/** Lowercase slug for config-local IDs (devices, providers, profiles). */
const ConfigIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** A secret is read from an environment variable or stored inline. Never logged (CONV-072). */
export const SecretSchema = z.union([
  z.strictObject({ env: z.string().min(1) }),
  z.strictObject({ value: z.string().min(1) }),
]);

export const DeviceSchema = z.strictObject({
  id: ConfigIdSchema, // e.g. "macbook-gpu", "gaming-pc-gpu", "cloud"
  name: z.string().min(1).max(80),
  concurrency: z.int().min(1).max(16).default(1), // ARCH-081
});

export const ProviderConfigSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: ConfigIdSchema,
    type: z.literal('ollama'),
    baseUrl: z.url(), // e.g. http://localhost:11434
    deviceId: ConfigIdSchema,
    keepAlive: z.string().default('30m'), // how long Ollama keeps the model loaded
  }),
  z.strictObject({
    id: ConfigIdSchema,
    type: z.literal('openai-compatible'), // LM Studio, llama.cpp server, vLLM, OpenRouter, …
    baseUrl: z.url(), // including /v1
    deviceId: ConfigIdSchema,
    apiKey: SecretSchema.optional(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
  z.strictObject({
    id: ConfigIdSchema,
    type: z.literal('anthropic'),
    deviceId: ConfigIdSchema,
    apiKey: SecretSchema,
    baseUrl: z.url().optional(),
  }),
  z.strictObject({
    id: ConfigIdSchema,
    type: z.literal('comfyui'), // image generation from mapped workflows (MED §4)
    baseUrl: z.url(), // e.g. http://localhost:8188
    deviceId: ConfigIdSchema,
  }),
  z.strictObject({
    id: ConfigIdSchema,
    type: z.literal('mock'), // tests and offline UI work (CONV-113)
    deviceId: ConfigIdSchema,
    fixturesDir: z.string().optional(),
    delayMs: z.int().min(0).max(5000).default(0), // pause per streamed word (PRV-083)
  }),
]);
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/** How a profile enforces structured output. Adapters implement each method (PRV §5). */
export const StructuredOutputMethodSchema = z.enum(['json-schema', 'tool-call', 'prompt-only']);

export const SamplingSchema = z.strictObject({
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  topK: z.int().positive().optional(),
  repeatPenalty: z.number().positive().optional(),
  presencePenalty: z.number().optional(),
});

export const ModelProfileSchema = z.strictObject({
  id: ConfigIdSchema,
  providerId: ConfigIdSchema,
  model: z.string().min(1), // provider's model name, e.g. "qwen3.6:35b-a3b"
  kind: z.enum(['text', 'embedding']),
  contextWindow: z.int().positive(), // tokens the runtime is configured for (e.g. Ollama num_ctx)
  maxOutputTokens: z.int().positive(),
  structuredOutput: StructuredOutputMethodSchema,
  streaming: z.boolean().default(true),
  thinking: z.enum(['off', 'on', 'provider-default']).default('off'),
  sampling: SamplingSchema.default({}),
  /** Initial estimate; recalibrated from recorded usage (PRV-071). */
  charsPerToken: z.number().positive().default(3.5),
  /** Token budget per context tier. Tier names are defined in 09-context. */
  contextBudget: z.record(z.string(), z.int().nonnegative()).default({}),
  timeoutMs: z.int().positive().default(120_000),
  embeddingDimensions: z.int().positive().optional(), // required when kind is 'embedding'
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

/** Image and speech models (MED §2). Media models never use text-model profiles. */
export const MediaProfileSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    id: ConfigIdSchema,
    kind: z.literal('image'),
    providerId: ConfigIdSchema, // comfyui or openai-compatible
    model: z.string().min(1).optional(), // openai-compatible: the image model name
    workflow: z.string().min(1).optional(), // comfyui: a workflow mapping file in <dataDir>/library/workflows/
    width: z.int().min(256).max(4096).default(832),
    height: z.int().min(256).max(4096).default(1216),
    promptStyle: z.enum(['prose', 'tags']).default('prose'), // how the illustrator writes prompts
    negativePrompt: z.string().max(1000).default(''),
    timeoutMs: z.int().positive().default(300_000),
  }),
  z.strictObject({
    id: ConfigIdSchema,
    kind: z.literal('speech-output'),
    providerId: ConfigIdSchema, // openai-compatible audio, e.g. Kokoro-FastAPI
    model: z.string().min(1),
    format: z.enum(['mp3', 'opus', 'wav']).default('mp3'),
    voices: z.array(z.string().min(1)).default([]), // empty = ask the provider (MED-051)
    timeoutMs: z.int().positive().default(60_000),
  }),
  z.strictObject({
    id: ConfigIdSchema,
    kind: z.literal('speech-input'),
    providerId: ConfigIdSchema, // openai-compatible audio, e.g. Speaches
    model: z.string().min(1),
    language: z.string().min(2).max(10).optional(), // e.g. "en"; omitted = detect
    timeoutMs: z.int().positive().default(60_000),
  }),
]);
export type MediaProfile = z.infer<typeof MediaProfileSchema>;

export const RoleAssignmentSchema = z.strictObject({
  profileId: ConfigIdSchema,
  sampling: SamplingSchema.optional(), // overrides the profile's sampling for this role
});

export const MachineConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  server: z
    .strictObject({
      host: z.string().default('0.0.0.0'), // ARCH-103
      port: z.int().min(1).max(65535).default(5317),
      pin: z
        .strictObject({
          hash: z.string().min(1), // scrypt hash, never the PIN itself
          localhostExempt: z.boolean().default(true),
        })
        .nullable()
        .default(null),
      /** HTTPS lets other devices use the microphone (OVR-011, MED-062). */
      https: z
        .discriminatedUnion('mode', [
          z.strictObject({ mode: z.literal('off') }),
          z.strictObject({ mode: z.literal('self-signed') }), // generated into <dataDir>/tls/
          z.strictObject({
            mode: z.literal('files'),
            certFile: z.string().min(1),
            keyFile: z.string().min(1),
          }),
        ])
        .default({ mode: 'off' }),
    })
    .prefault({}),
  dataDir: z.string().nullable().default(null), // null = OS default (ARCH-030)
  devices: z.array(DeviceSchema).min(1),
  providers: z.array(ProviderConfigSchema).min(1),
  modelProfiles: z.array(ModelProfileSchema).default([]),
  /**
   * Null = unassigned. A call for an unassigned role fails with `not_configured`
   * (PRV-001), except for the three roles that fall back instead.
   */
  roles: z
    .strictObject({
      adjudicator: RoleAssignmentSchema.nullable().default(null),
      narrator: RoleAssignmentSchema.nullable().default(null),
      'npc-voice': RoleAssignmentSchema.nullable().default(null), // null = use the narrator's
      extractor: RoleAssignmentSchema.nullable().default(null),
      consolidator: RoleAssignmentSchema.nullable().default(null),
      'world-ticker': RoleAssignmentSchema.nullable().default(null),
      embedder: RoleAssignmentSchema.nullable().default(null),
      illustrator: RoleAssignmentSchema.nullable().default(null), // null = image prompts from templates only
      'speech-segmenter': RoleAssignmentSchema.nullable().default(null), // null = use the extractor's
    })
    .prefault({}),
  mediaProfiles: z.array(MediaProfileSchema).default([]),
  /** Which media profiles this machine uses (MED §2). Null = that feature is off here. */
  media: z
    .strictObject({
      imageProfileId: ConfigIdSchema.nullable().default(null),
      speechOutputProfileId: ConfigIdSchema.nullable().default(null),
      speechInput: z
        .strictObject({
          mode: z.enum(['off', 'browser', 'server']).default('off'),
          profileId: ConfigIdSchema.nullable().default(null), // required for 'server'
        })
        .prefault({}),
    })
    .prefault({}),
  /** Used instead of `roles` when the campaign's tone profile sets any content category to 'explicit'. */
  explicitContentRoles: z.partialRecord(ModelRoleSchema, RoleAssignmentSchema).default({}),
  queue: z
    .strictObject({
      preemptBackground: z.boolean().default(true), // PRV-064
      maxAttempts: z.int().min(1).max(10).default(3),
    })
    .prefault({}),
  /** Prompt assembly (09-context). */
  context: z
    .strictObject({
      /** shared: one narrator call; key: separate calls for key NPCs; strict: for every speaking NPC. */
      npcVoice: z.enum(['shared', 'key', 'strict']).default('key'),
      maxVoicedNpcsPerTurn: z.int().min(0).max(6).default(2),
      keySecretImportance: z.int().min(1).max(10).default(7), // CTX-061
      previousSceneSummaries: z.int().min(0).max(20).default(3),
      oocTurnsKept: z.int().min(0).max(20).default(3), // TRN-020
      transcriptChunkTurns: z.int().min(2).max(50).default(8), // CTX-041
    })
    .prefault({}),
  /** Off-screen simulation limits (12-time-world §5). Lower them on slow hardware. */
  world: z
    .strictObject({
      enabled: z.boolean().default(true),
      maxFineTicks: z.int().min(0).max(12).default(3), // more boundaries than this go coarse
      maxCoarsePeriods: z.int().min(1).max(24).default(5),
      maxActorsPerTick: z.int().min(0).max(30).default(8),
      actorsPerCall: z.int().min(1).max(10).default(4),
      recentInvolvementDays: z.number().positive().default(7),
    })
    .prefault({}),
  /** Retrieval and consolidation tuning (08-memory §6, §8). Defaults suit most campaigns. */
  memory: z
    .strictObject({
      weights: z
        .strictObject({
          importance: z.number().min(0).max(10).default(1),
          recency: z.number().min(0).max(10).default(1),
          relevance: z.number().min(0).max(10).default(1.5),
          entities: z.number().min(0).max(10).default(0.5),
          pc: z.number().min(0).max(10).default(0.5),
        })
        .prefault({}),
      recencyHalfLifeDays: z.number().positive().default(14), // game days
      pinnedRecent: z.int().min(0).max(10).default(3),
      consolidation: z
        .strictObject({
          enabled: z.boolean().default(true),
          afterDays: z.number().positive().default(30), // game days since the observation
          maxImportance: z.int().min(1).max(10).default(4),
          minGroupSize: z.int().min(2).max(50).default(4),
          everyTurns: z.int().min(1).max(500).default(25),
        })
        .prefault({}),
    })
    .prefault({}),
  retention: z
    .strictObject({
      modelCallRecordDays: z.int().positive().nullable().default(30), // null = keep forever
    })
    .prefault({}),
});
export type MachineConfig = z.infer<typeof MachineConfigSchema>;
```

### 2.1 Example

A MacBook running Qwen locally, with the gaming PC's Ollama and Anthropic available.
This file validates against the schema above.

```json
{
  "schemaVersion": 1,
  "server": { "host": "0.0.0.0", "port": 5317, "pin": null },
  "dataDir": null,
  "devices": [
    { "id": "macbook-gpu", "name": "MacBook Pro GPU" },
    { "id": "gaming-pc-gpu", "name": "Gaming PC GPU" },
    { "id": "cloud", "name": "Cloud APIs", "concurrency": 4 }
  ],
  "providers": [
    { "id": "ollama-local", "type": "ollama", "baseUrl": "http://localhost:11434", "deviceId": "macbook-gpu" },
    { "id": "ollama-pc", "type": "ollama", "baseUrl": "http://192.168.1.50:11434", "deviceId": "gaming-pc-gpu" },
    { "id": "anthropic", "type": "anthropic", "deviceId": "cloud", "apiKey": { "env": "ANTHROPIC_API_KEY" } }
  ],
  "modelProfiles": [
    {
      "id": "qwen-local",
      "providerId": "ollama-local",
      "model": "qwen3.6:35b-a3b",
      "kind": "text",
      "contextWindow": 32768,
      "maxOutputTokens": 2048,
      "structuredOutput": "json-schema",
      "thinking": "off",
      "sampling": { "temperature": 0.7, "presencePenalty": 1.5 }
    },
    {
      "id": "embed-local",
      "providerId": "ollama-local",
      "model": "nomic-embed-text",
      "kind": "embedding",
      "contextWindow": 8192,
      "maxOutputTokens": 1,
      "structuredOutput": "prompt-only",
      "embeddingDimensions": 768
    }
  ],
  "roles": {
    "adjudicator": { "profileId": "qwen-local", "sampling": { "temperature": 0.3 } },
    "narrator": { "profileId": "qwen-local" },
    "npc-voice": null,
    "extractor": { "profileId": "qwen-local", "sampling": { "temperature": 0.1 } },
    "consolidator": { "profileId": "qwen-local", "sampling": { "temperature": 0.2 } },
    "world-ticker": { "profileId": "qwen-local", "sampling": { "temperature": 0.5 } },
    "embedder": { "profileId": "embed-local" }
  },
  "explicitContentRoles": {},
  "queue": { "preemptBackground": true, "maxAttempts": 3 },
  "retention": { "modelCallRecordDays": 30 }
}
```

### 2.2 Rules

- **PRV-001** Machine config is stored at `<dataDir>/machine-config.json`. If it is
  missing on first start, the server writes a default with one device, one Ollama
  provider on `localhost`, no model profiles, and every role unassigned (`null`).
  While no model profile exists, the client opens the settings screen instead of the
  library. A model call for an unassigned role fails with
  `not_configured`, whose message names the role and points to settings; `npc-voice`,
  `illustrator`, and `speech-segmenter` fall back instead (PRV-009, PRV-015).
- **PRV-002** On load, after schema validation, cross-references are checked: every
  `providerId`, `deviceId`, and `profileId` resolves; an assigned `embedder` role uses a
  profile with `kind: 'embedding'` and every other assigned role uses `kind: 'text'`;
  embedding profiles have `embeddingDimensions`. All errors are reported together (as
  SCH-100).
- **PRV-003** The settings UI edits machine config through the API. Saves are validated
  first, then written atomically (write a temp file, then rename).
- **PRV-004** Changes to devices, providers, profiles, roles, and queue settings apply
  to the next model call without restart. Changes to `server` (except `server.pin`,
  which applies at once) or `dataDir` require a restart, and the UI says so.
- **PRV-005** Secrets SHOULD use `{ "env": … }`. Inline secrets are allowed because the
  file never leaves the machine (ARCH-032), but they are never logged, returned by the
  API, or shown in the UI after entry.
- **PRV-006** When a campaign's content settings (CSET-020) set any category to
  `explicit`, each role uses its `explicitContentRoles` assignment if one exists,
  otherwise its normal assignment. Not while a minor is involved (CSET-043).
- **PRV-007** The player can regenerate any stage of any turn with a different profile,
  chosen at the time (the "regenerate with…" control). This covers refusals and weak
  outputs without any automatic detection.
- **PRV-008** The `memory` section tunes retrieval and consolidation
  (`08-memory.md` MEM-078, MEM-100). It is optional; every value has a default.
- **PRV-009** The `context` section sets NPC voicing and transcript handling
  (`09-context.md` §5–6), and the `world` section limits off-screen simulation
  (`12-time-world.md` §5). Both are optional; every value has a default. When the
  `npc-voice` role is null, voice calls use the narrator's assignment.
- **PRV-015** `mediaProfiles` and the `media` section configure images and voice
  (`15-media.md` §2). The `illustrator` and `speech-segmenter` roles are optional: when
  null, image prompts come from templates and segmentation uses the extractor's
  assignment. `server.https` enables microphone use from other devices (MED-062).

### 2.3 Suggested role sampling (non-normative)

| Role | Temperature | Why |
|---|---|---|
| adjudicator | 0.2–0.4 | Consistent, fair rulings |
| narrator | 0.7–0.9 | Varied prose |
| npc-voice | 0.7–0.9 | Distinct voices |
| extractor | 0.0–0.2 | Faithful, repeatable extraction |
| consolidator | 0.1–0.3 | Faithful summaries |
| world-ticker | 0.4–0.6 | Plausible but not wild off-screen events |
| illustrator | 0.5–0.8 | Visual variety within the art style |
| speech-segmenter | 0.0–0.1 | Exact reproduction of the narration |

## 3. Provider adapters — `types.ts`

```ts
import type {
  AppError,
  ChatMessage,
  ModelProfile,
  ModelRole,
  ProviderConfig,
  ProviderHealth,
  Result,
  TokenUsage,
} from '@mythos/contracts';

export type ResponseFormat =
  { type: 'text' } | { type: 'json'; schemaName: string; jsonSchema: Record<string, unknown> };

export type TextRequest = {
  /** For logs and the mock adapter's fixture keys (PRV-081); real adapters ignore it. */
  role: ModelRole;
  profile: ModelProfile;
  messages: ChatMessage[];
  format: ResponseFormat;
  maxOutputTokens: number;
  sampling: ModelProfile['sampling'];
  signal: AbortSignal;
  /** Called with each text delta when streaming. Omit for non-streamed calls. */
  onDelta?: (delta: string) => void;
};

export type TextResponse = {
  text: string; // final answer text, thinking removed
  thinking: string | null; // captured reasoning, if the model produced any
  usage: TokenUsage;
  finishReason: 'stop' | 'length' | 'cancelled' | 'refusal';
};

/** Provider failures map onto contract error codes (03-contracts §12). */
export type ProviderError = AppError & {
  code:
    | 'provider_unavailable'
    | 'provider_timeout'
    | 'provider_rejected'
    | 'rate_limited'
    | 'cancelled';
  retryable: boolean;
  httpStatus: number | null;
};

/** Every provider adapter implements this (ARCH-133). */
export type ProviderAdapter = {
  readonly config: ProviderConfig;
  health(signal: AbortSignal): Promise<ProviderHealth>;
  listModels(signal: AbortSignal): Promise<Result<string[], ProviderError>>;
  /** Present when the provider serves text models. */
  text?: {
    generate(req: TextRequest): Promise<Result<TextResponse, ProviderError>>;
  };
  /** Present when the provider serves embedding models. */
  embedding?: {
    embed(
      profile: ModelProfile,
      inputs: string[],
      signal: AbortSignal,
    ): Promise<Result<number[][], ProviderError>>;
  };
};
```

- **PRV-010** Phase 1 ships three text adapters (`ollama`, `openai-compatible`,
  `anthropic`) and the `mock` adapter. Phases 9 and 10 add image and audio members to
  `openai-compatible` and a `comfyui` adapter (`15-media.md` §4), implementing the same
  `ProviderAdapter` shape with new optional members.
- **PRV-011** Adapters call HTTP APIs with the built-in `fetch`. Vendor SDKs are not
  used (CONV-090), so every adapter is a small file a human can read end to end.
- **PRV-012** Adapters translate provider responses and errors into `TextResponse` and
  `ProviderError`. Nothing outside an adapter knows a provider's wire format.
- **PRV-013** Error mapping: connection refused / DNS failure → `provider_unavailable`
  (retryable); timeout, when nothing arrives for the profile's `timeoutMs` (no response
  headers, or no next chunk of the body) → `provider_timeout` (retryable); HTTP 429 →
  `rate_limited` (retryable, with the wait `retry-after` asks for as
  `details.retryAfterSeconds`); HTTP 5xx, or an error the provider reports inside a 200
  response → `provider_unavailable` (retryable); other 4xx, including a refusal sent as
  one → `provider_rejected` (not retryable); abort → `cancelled`. A refusal in a 200
  response is not an error: the adapter returns `ok` with `finishReason: 'refusal'`
  (CSET-050).

### 3.1 Adapter specifics

**Ollama** uses Ollama's native chat API rather than its OpenAI-compatible endpoint,
because only the native API lets the engine control these per request:

- **PRV-020** Context size: set from `profile.contextWindow`. Ollama's small default
  context would otherwise silently truncate prompts.
- **PRV-021** `keep_alive` from provider config, so the model stays loaded between turns.
- **PRV-022** Thinking: `off` disables it explicitly; `on` enables it and captures the
  reasoning into `TextResponse.thinking`.
- **PRV-023** Structured output via the native schema parameter (`json-schema` method).

**OpenAI-compatible** covers LM Studio, llama.cpp's server, vLLM, OpenRouter, and
others. Support for schema-constrained output varies by server and version.

- **PRV-030** `json-schema` uses the `response_format` JSON-schema option; `tool-call`
  uses a single forced tool; `prompt-only` sends no format parameter.
- **PRV-031** Because support varies, the settings UI offers a **probe** (PRV-090) that
  tests each method against the profile and recommends one.

**Anthropic** uses the Messages API.

- **PRV-040** `json-schema` uses the API's native JSON output format parameter. That
  feature supports only a subset of JSON Schema: objects must set
  `additionalProperties: false`, numeric and string-length constraints are not
  supported, and there are complexity limits. The schema is therefore **adapted**
  before the adapter receives it (PRV-050 step 2, PRV-052); full Zod validation still
  runs on the result.
- **PRV-041** Messages marked `cacheBreakpoint` get a prompt-cache breakpoint, so the
  stable prefix (09-context) is billed and processed as cached input.
- **PRV-042** The adapter targets the current API shape at implementation time. Its
  README links the API documentation it was written against.
- **PRV-043** The Anthropic adapter merges consecutive same-role messages into one
  message with one content block each, keeping each block's breakpoint (CTX-011). The
  API would combine them itself, but merging first keeps the request the adapter sends,
  and where each breakpoint falls in it, explicit.

**Mock** — see §8.

## 4. Streaming

- **PRV-045** Narration and NPC voice are streamed when the profile has
  `streaming: true`; each delta is forwarded to the client as a `narration.delta`
  event. Otherwise the full text is sent as one delta when complete.
- **PRV-046** Thinking content is never streamed to the client as narration. Adapters
  separate it from answer text (including inline `<think>…</think>` blocks).
- **PRV-047** Cancelling an interactive job aborts the HTTP request. Partial narration
  is kept as the turn's narration and marked incomplete; the player can regenerate.
  An adapter aborted after text has arrived returns `ok` with that text and
  `finishReason: 'cancelled'`; aborted before any text, it returns the `cancelled`
  error (PRV-013). `streamText` passes the reason on in `StreamedText`.


## 5. The structured-output pipeline

Every structured call (adjudication, extraction, world ticks, consolidation, and
phase-8 tone parsing) goes through `callStructured`. No module calls an adapter
directly for structured output, except the probe (PRV-092), which uses the same schema
adaptation.

The module's call surface (`structured.ts`), including plain-text streaming. The
message, usage, and record shapes it uses are contracts (`03-contracts.md` §14),
because records are stored as JSON and sent to the inspector:

```ts
import type { z } from 'zod';
import type {
  AppError,
  ChatMessage,
  ModelCallRecord,
  ModelRole,
  Result,
  SemanticIssue,
} from '@mythos/contracts';
import type { JobContext } from './queue';
import type { TextResponse } from './types';

/** The prompt's tiers, memories, and templates, recorded with the call (CTX-090). */
export type PromptReport = Pick<ModelCallRecord, 'tiers' | 'retrieved' | 'templates'>;

export type StructuredCallOptions<T> = {
  role: ModelRole;
  schemaName: string; // e.g. "ruling", "extraction"
  schema: z.ZodType<T>;
  messages: ChatMessage[];
  report: PromptReport;
  /** Runs after schema validation. Returning issues triggers a retry with them fed back. */
  semanticCheck?: (value: T) => SemanticIssue[];
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  /** The background job this call runs inside, or null to run as an interactive job (PRV-067). */
  job: JobContext | null;
};

/** Runs the full structured-output pipeline (PRV §5). Records every attempt (ARCH-060). */
export type CallStructured = <T>(options: StructuredCallOptions<T>) => Promise<Result<T, AppError>>;

export type StreamTextOptions = {
  role: ModelRole;
  messages: ChatMessage[];
  report: PromptReport;
  campaignId: string;
  turnId: string | null;
  signal: AbortSignal;
  onDelta: (delta: string) => void;
  /** The background job this call runs inside, or null to run as an interactive job (PRV-067). */
  job: JobContext | null;
};

/** Text that streamed. `finishReason` says whether it is complete (PRV-047, TRN-051). */
export type StreamedText = { text: string; finishReason: TextResponse['finishReason'] };

/** Streams plain text (narration, NPC voice). Records the call (ARCH-060). */
export type StreamText = (options: StreamTextOptions) => Promise<Result<StreamedText, AppError>>;
```

- **PRV-050** Steps, in order:
  1. **Schema** — convert the Zod schema to JSON Schema (`z.toJSONSchema`), cached per
     schema. Rulings use the campaign's specialized schema (CON-035), cached per
     campaign and ruleset.
  2. **Adapt** — transform the JSON Schema for the profile's provider and method
     (PRV-052).
  3. **Instruct** — the engine adds a format instruction to the prompt, as a system
     message of its own right after the prompt's leading system messages, so a floor
     repeated at the end of the task tier stays nearest the output (CSET-042). For
     `prompt-only` this includes the JSON Schema and a minimal example; for the other
     methods, a one-line reminder. Templates never contain format instructions
     (09-context).
  4. **Call** — through the job queue on the role's device.
  5. **Extract** — take the answer text (thinking removed), strip code fences, take the
     outermost JSON object, and run `jsonrepair` if it fails to parse.
  6. **Validate** — Zod parse, then `semanticCheck`.
  7. **Retry** — on failure in steps 5–6, retry with the previous output appended as
     an assistant message and a user message listing the problems (parse error, Zod
     issues by path, semantic issues). At most **2** retries.
  8. **Result** — the parsed value, or `model_output_invalid` with every attempt's
     problems in `details`. The caller decides the fallback (06-turn-engine,
     08-memory).
- **PRV-051** Transient provider errors are retried by the queue (§6), separately from
  validation retries in step 7.
- **PRV-052** Schema adaptation per provider is a pure function with unit tests. For
  Anthropic's `json-schema` and `tool-call` methods it sets `additionalProperties:
  false` on every object; removes length and numeric-range constraints (`minLength`,
  `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`,
  `multipleOf`), `maxItems`, a `minItems` above 1, and `$schema`; turns `oneOf` into
  `anyOf`; and drops a `format` Anthropic does not list, a `pattern` with
  backreferences, lookaround, or word boundaries, and an `enum` of values that are not
  strings, numbers, booleans, or null. What adaptation cannot change, such as a
  recursive schema or one past Anthropic's complexity limits, is refused by the
  provider and falls back under PRV-053. `prompt-only`, and the other adapters, get the
  schema unchanged unless an adapter's README documents a limitation.
- **PRV-053** If a provider rejects the schema itself (`provider_rejected` on a
  `json-schema` or `tool-call` request), the call is retried once as `prompt-only` and
  the switch is recorded in the model call record.
- **PRV-054** Every attempt is recorded in the call's `ModelCallRecord`, including
  failed ones (ARCH-060), together with the caller's `PromptReport` (CTX-090).

## 6. Job queue — `queue.ts`

```ts
import type { AppError, JobPriority, Result } from '@mythos/contracts';
import type { z } from 'zod';

/**
 * Handlers are registered by job type at startup. Persisted jobs store only the type and
 * a JSON payload, so after a restart the queue finds the handler by type (ARCH-082).
 */
export type JobHandler<P> = {
  type: string; // e.g. "extraction"
  payloadSchema: z.ZodType<P>;
  priority: JobPriority;
  persisted: boolean; // true for background jobs
  run(payload: P, ctx: JobContext): Promise<Result<void, AppError>>;
  /** The failure path, run once with the last error when the job ends `failed` (PRV-063). */
  onFailed?(payload: P, error: AppError): Promise<void>;
};

export type JobContext = {
  jobId: string;
  attempt: number;
  signal: AbortSignal; // aborted on cancel or preemption
};

export type EnqueueOptions = {
  type: string;
  payload: unknown; // validated against the handler's payloadSchema on enqueue
  deviceId: string;
  campaignId: string;
  turnId: string | null;
};

/** Where an interactive job runs. `campaignId` is null for machine-level calls (PRV-092). */
export type InteractiveOptions = {
  deviceId: string;
  campaignId: string | null;
  turnId: string | null;
};

export type JobQueue = {
  register<P>(handler: JobHandler<P>): void;
  enqueue(options: EnqueueOptions): Result<{ jobId: string }, AppError>;
  cancel(jobId: string): void;
  /** Resolves when the job finishes, fails permanently, or is cancelled. */
  wait(jobId: string): Promise<Result<void, AppError>>;
  /**
   * Runs `work` as an interactive job and resolves with its result. Interactive jobs are
   * never persisted, so `work` may capture callbacks such as `onDelta` (PRV-067).
   */
  runInteractive<T>(
    options: InteractiveOptions,
    work: (ctx: JobContext) => Promise<Result<T, AppError>>,
  ): { jobId: string; result: Promise<Result<T, AppError>> };
};
```

- **PRV-060** Scheduling: each device runs up to `concurrency` jobs. When a slot frees,
  it takes the highest-priority queued job for that device (ARCH-080), oldest first
  within a priority.
- **PRV-061** Every model call runs in a job slot. Interactive calls (adjudication,
  narration, NPC voice) run through `runInteractive` (PRV-067) and are awaited by
  their caller; they are not persisted. The caller cancels one by aborting the signal
  it passed to `callStructured` or `streamText`, which cancels the job
  (`cancel(jobId)`) and so aborts the signal the work runs under.
- **PRV-062** Persisted jobs are stored in the campaign database with type, payload,
  status, attempts, and timestamps. On server start, the queue re-enqueues every
  campaign's unfinished persisted jobs (`queued` and `running`), in the order they were
  stored; a campaign that fails to open or migrate is logged and skipped. Before a
  campaign's first new job, the queue also takes back that campaign's stored jobs, once
  per campaign per process.
- **PRV-063** A job that fails with a retryable error is re-queued with exponential
  backoff, 2 s after the first failure and four times longer after each later one, at
  most 30 s (2 s, 8 s, 30 s, 30 s, …), or the error's `details.retryAfterSeconds` when
  that is longer, until `queue.maxAttempts`. A non-retryable error or
  exhausted attempts marks it `failed`, and its handler's failure path, `onFailed`,
  runs (e.g. `extraction-failed` on the turn).
- **PRV-064** Preemption: if `preemptBackground` is true and an interactive job is
  queued for a device whose slots are all running background jobs, the most recently
  started background job is aborted and re-queued **without** counting an attempt.
  Local generation can't be paused, so this wastes that partial work in exchange for
  responsiveness.
- **PRV-065** Every status change emits a `job.updated` event (03-contracts §13).
- **PRV-066** Handlers are registered at startup in the composition root. Enqueueing an
  unknown type or an invalid payload is a programmer error and throws (CONV-041).
- **PRV-067** Interactive calls use `runInteractive`: the caller passes the work as a
  function, which the queue runs on the device at interactive priority and whose
  result it returns. Because interactive jobs are never persisted (PRV-061), the work
  may capture callbacks such as `onDelta`. Handlers and `enqueue` are for persisted
  background jobs. A model call made by a background job's handler passes that job's
  `JobContext` as `job` and runs in the job's own slot, under its signal, without
  starting a job of its own; with `job: null` the call runs as an interactive job.

## 7. Token estimation and calibration

- **PRV-070** Before a call, tokens are estimated as
  `ceil(characters / charsPerToken)`. No tokenizer libraries are used; exact counts are
  impossible across providers anyway.
- **PRV-071** After each call, the provider-reported `inputTokens` is compared with the
  estimate, and the calibrated ratio for the profile and its model is updated as an
  exponential moving average. A profile estimates with its own `charsPerToken` until it
  has a calibrated ratio, and changing its model starts it there again. Calibration is
  stored in `<dataDir>/calibration.json`, not in machine config, so editing config never
  clobbers it.
- **PRV-072** The context module budgets against the calibrated estimate with a 10%
  safety margin, and never assembles a prompt where estimated input plus
  `maxOutputTokens` exceeds `contextWindow` (09-context).

## 8. The mock provider

- **PRV-080** The mock adapter has two modes: **scripted** (tests enqueue exact
  responses per role, in order) and **fixture** (responses are read from recorded
  files).
- **PRV-081** Fixtures are keyed by test name, role, and the call's sequence number
  among that role's calls within the test, not by prompt text, so template edits do not
  invalidate them. Fixture files
  are committed (CONV-114). The mock learns the role from `TextRequest.role`, and each
  test gives its mock a fixture scope named after the test.
- **PRV-082** The server's `record-fixtures` command (`apps/server/src/cli/`,
  ARCH-007) runs a named test scenario against a real profile and writes its fixtures,
  overwriting only that scenario's files.
- **PRV-083** For offline UI work, a `mock` provider with no fixtures returns short,
  schema-valid placeholder outputs for every role, so the whole app is clickable
  without a model. Its `delayMs` pauses after each streamed word, so streaming and Stop
  can be seen and tested.
- **PRV-084** The mock adapter can simulate each `ProviderError` code, latency, and
  streaming, so failure paths are testable.

## 9. Settings support

- **PRV-090** **Probe**: for a chosen profile, the server sends a tiny structured
  request with each method, then a text prompt of about 1,000 tokens, and reports:
  reachable, model present, which structured-output methods produced valid output,
  approximate prompt processing and generation speed, and whether thinking was
  emitted. The UI suggests settings from the result.
- **PRV-091** `listModels` populates model pickers; `health` drives a status indicator
  per provider in the UI.
- **PRV-092** The probe calls adapters directly, not through `callStructured`, so it can
  force each structured-output method; it adapts schemas with the same function
  (PRV-052) and sends `role: 'narrator'`. Each request runs with `runInteractive` on
  the profile's device with `campaignId: null`. Nothing is recorded: model call
  records belong to campaigns (ARCH-060).

## Traps

- **Reported input tokens can leave out the cached part of the prompt (PRV-071,
  `TokenUsage.inputTokens`).** Anthropic's `input_tokens` excludes cache reads and
  writes, which it reports in separate fields, and older versions of Ollama left a
  prefix reused from the previous call out of `prompt_eval_count`. An adapter must
  report the whole prompt in `inputTokens` (Decisions). Left unfixed, each cached call
  makes the calibrated ratio drift high, estimates fall short, and prompts overflow the
  context window. Ollama 0.40.14 counts the whole prompt in `prompt_eval_count` and the
  cached part in `prompt_eval_cached_count`, which its documentation does not say but
  its source does (read for P1-T11 on 2026-11-05), and OpenAI's `prompt_tokens`
  includes its `cached_tokens`. Anthropic's behavior is confirmed below ("Anthropic
  reports usage in pieces").
- **A handler that ignores its signal holds its device (PRV-064, ARCH-083).**
  Preemption, `cancel`, and `stop()` only abort `JobContext.signal`, and the slot frees
  when the run settles (Decisions). A handler, and the work given to `runInteractive`,
  must pass the signal to every call it makes and return soon after it aborts, or the
  interactive job behind it waits.
- **Register every handler before `resume()` (PRV-062, PRV-066).** A stored job whose
  type has no handler when `resume()` runs is marked `failed` and never runs, so the
  composition root registers every job type first.
- **Anthropic reports usage in pieces (PRV-071, `adapters/anthropic-stream.ts`).**
  Confirmed in its documentation on 2026-11-05: `input_tokens` leaves out
  `cache_read_input_tokens` and `cache_creation_input_tokens`, and the whole prompt is the
  sum of the three. `message_start` carries the input counts; `message_delta` counts are
  cumulative and may repeat them. Reading only `message_delta`, or only `input_tokens`,
  undercounts the prompt.
- **Anthropic's thinking is empty unless asked for (PRV-046).** Current models default
  to `display: 'omitted'` and stream thinking blocks with no text, so a profile with
  thinking `on` must send `display: 'summarized'`, or `thinking` is always null.
- **`jsonrepair` repairs almost anything (PRV-050 step 5, `structured-output.ts`).** It
  turns `{"a": }}}` into `{"a": null}` and `{"a": @#$}` into `{"a": "@#$"}`, so a broken
  answer seldom ends as a parse error: the Zod schema is what rejects it. A test that
  needs a parse error must use text `jsonrepair` refuses, such as `{"a": "x" : "y"}` or no
  `{` at all.
- **An Anthropic spend-cap 429 is not worth retrying (PRV-013).** A usage tier's monthly
  spend cap answers with a 429 that has no `retry-after` and keeps failing until access
  resumes. PRV-013 calls every 429 retryable, so the queue retries it up to
  `maxAttempts`; the message quotes Anthropic's, which says what happened.

## Decisions

| Question | Decision | Rejected and why | Decided by |
|---|---|---|---|
| When is `restartRequired` true (PRV-004)? | When the saved `server` section (leaving out `server.pin`) or `dataDir` differs from the config the server started with, so the notice stays until a restart. | Comparing with the previous save: a second save would clear the notice although the change has still not applied. | Claude (ruling) |
| What does PRV-002 check beyond the references it lists? | IDs are unique within `devices`, `providers`, `modelProfiles`, and `mediaProfiles`. Each `media` pick resolves to a media profile of its own kind (MED-002), and `speechInput.mode: 'server'` needs a `profileId`. | Only the listed references: a duplicate ID makes "resolves" ambiguous, and a media profile of the wrong kind would fail only at its first call. | Claude (ruling) |
| What does the first-start default contain (PRV-001)? | Only the required parts, with every role written as `null`. The schema's defaults supply the rest, and a save writes the complete validated config. | Writing every default: a later change to a default would never reach an untouched file. | Claude (ruling) |
| What does the mock return for a JSON-format call with no script or fixtures (PRV-083)? | The placeholder for its `schemaName` from a table in the mock (`jsonPlaceholders`). Each later phase adds a placeholder for each schema it introduces, with a test that it parses with that schema. In phase 1 it holds only the probe's schema (below), since no structured role runs in phase-1 play. An unknown schema name returns `provider_rejected`. | Generating values from the JSON Schema: much more code than a table, for output that is valid but meaningless in play. | owner |
| What is a mock provider's `fixturesDir` (PRV-081)? | The test scenario's folder itself: a test sets it to `<root>/<scope>`, so fixture mode works through `createAdapter` like any other config. The scope is a kebab-case slug named after the test. | The fixtures root, with the scope given separately: the provider config has no field for it, so fixture mode would not work through the registry. The test name itself as the folder: test names contain `:`, which Windows file names cannot. | owner |
| How is the copied `providers/types.ts` kept equal to its code block (OVR-033)? | The repository's spec check, `scripts/check-spec.ts`, compares it byte for byte with `spec/reference/server-types/providers/types.ts`, as it does the contracts. A later pure copy is one more entry in its `serverTypeCopies`. Copies that add an implementation after the verbatim types, such as P1-T13's `queue.ts`, are not compared yet. | Relying on review alone: a hand edit to the copy would pass `pnpm check`. | owner |
| What key is a calibrated ratio stored under (PRV-071)? | The profile's ID and its model, so changing a profile's model starts again from the profile's own `charsPerToken`. | The profile ID alone: a ratio learned for one model would carry over to a model with a different tokenizer. | owner |
| Where does `estimateTokens` live (PRV-070)? | In `core` (`prompts/context.ts`, beside the budgets), so the context module budgets with the same estimate calibration uses without importing `providers` (CTX-110, PRV-072). The providers module's `tokens.ts` re-exports it, so nothing that imports it from there changed. | A private copy in the context module: two definitions of PRV-070 that could drift apart. Passing it through `ContextDependencies`: it would change the verbatim 09-context §10 block. | owner |
| What does a fixture's sequence number count (PRV-081)? | The calls of that fixture's role within the test, from `001`: `002-narrator.json` is the second narrator call, whatever other roles ran between. | One count across all roles: background extraction interleaves with interactive calls in no fixed order, so the numbers would change from run to run. | Claude (ruling) |
| What does `TokenUsage.inputTokens` count (PRV-071)? | The whole prompt, cached tokens included; `cachedInputTokens` is the cached part of it. Calibration compares it with the estimate, which is for the whole prompt. | Only the uncached tokens: a cached prefix would make the reported count much smaller than the estimate, so calibration would drift until prompts overflow (Traps). | Claude (ruling) |
| When does the queue take back stored jobs (PRV-062, TRN-012)? | At server start, `resume()` goes through `listCampaigns()` and re-enqueues every campaign's unfinished persisted jobs, `queued` and `running`, in stored order. Before a campaign's first new job, the queue also takes back its stored jobs, once per campaign per process. A campaign that fails to open or migrate is logged and skipped. | Re-enqueueing when a campaign is opened, as PRV-062 first said: nothing opens a campaign for its background jobs, so a turn left `extracting` would wait until the player opened it, although TRN-012 resumes such turns on server start. | owner |
| Does `runInteractive` retry transient errors (PRV-051, PRV-067)? | Yes, with the background jobs' policy: an error the work returns with `retryable: true` is retried with backoff until `queue.maxAttempts`, and the caller gets the last run's result. Every phase-1 model call is interactive, so this is how PRV-051 holds in phase 1. An error after text has streamed must not be retryable (Open). | Retrying only background jobs: phase 1 has none, so a transient provider error would fail every phase-1 call at once. | owner |
| How does a handler's failure path run (PRV-063)? | Through an optional `onFailed(payload, error)` on `JobHandler`, which the queue calls once, with the last error, after the job is stored and published as `failed`. A stored job that has no handler, or whose payload its handler rejects, is marked `failed` without it. | Leaving it to whoever awaits `wait`: nobody awaits a job resumed after a restart, so its turn would stay `extracting`. | owner |
| What concurrency does a job get when its device is not in machine config (ARCH-081)? | 1, the schema's default, as every device gets while machine config fails to load. The job still runs. | Failing the job: a device renamed or removed in settings would fail every job already queued for it. | owner |
| Which handlers may `register` take (PRV-066, PRV-067)? | Only persisted background ones: it throws unless `persisted` is true and `priority` is not `interactive`, and for a type already registered or the type `interactive`. Interactive work goes through `runInteractive`. | Accepting unpersisted or interactive handlers: `enqueue` would need a second kind of job that is never stored, which `runInteractive` already is. | Claude (ruling) |
| What type does an interactive job have (PRV-065, PRV-067)? | `'interactive'`, the same as its priority, in every `job.updated` record. No handler may use that type. | A type per caller, such as its role: `InteractiveOptions` names none, and it would look like a handler's type. | Claude (ruling) |
| Which errors does the queue retry (PRV-051, PRV-063)? | Only an error that carries `retryable: true`, as each `ProviderError` does by PRV-013. A plain `AppError`, a thrown error (`internal_error`), and `cancelled` are never retried. | Retrying by error code: the same code can be safe to retry from an adapter and unsafe from a call that has already streamed text (Open), and only the code that returns the error knows which. | Claude (ruling) |
| What are PRV-063's backoff waits? | 2 s after the first failure, four times longer after each later one, at most 30 s: 2 s, 8 s, 30 s, 30 s. A `details.retryAfterSeconds` (PRV-013's `retry-after`) longer than that is the wait instead. The job stays `queued` while it waits, on a timer injected into the queue. | Doubling: PRV-063's own example, 2 s then 8 s, is four times. No cap: a fifth attempt would wait over eight minutes. | Claude (ruling) |
| What does a job's `attempts` count (PRV-063, PRV-064)? | Runs that ended in success or failure; `JobContext.attempt` is `attempts + 1`. A run that is preempted, cancelled, or cut off by `stop()` or a crash leaves it unchanged. A preempted or stopped run that returns `ok` anyway succeeds, since its work is done. | Counting every start: a job preempted often enough would use up its attempts without failing. Running again a preempted job that returned `ok`: its handler could commit twice. | Claude (ruling) |
| What happens to a cancelled job (ARCH-083)? | It ends `cancelled`, is never retried, and `wait` resolves with the `cancelled` error. A queued job, or one waiting to retry, ends at once and its timer is cleared. A running job has its signal aborted and ends when its run settles; `runInteractive` then resolves with whatever the work returned, so partial narration survives (PRV-047). | Ending a running job at the moment of the cancel: the device's next job would start while the first is still stopping. | Claude (ruling) |
| What does `wait` return for a job the queue does not hold (§6)? | A `not_found` error, at once. The queue forgets a job when it ends, so this includes a job that has finished; a background job's stored row keeps its last status. | Keeping finished jobs in memory to answer late calls: the map would grow for the life of the process. | Claude (ruling) |
| When does a preempted job's slot free (PRV-064)? | When its run settles after the abort, not at the abort. Until then the interactive job waits, nothing else starts on the device, and no second job there is preempted. | Freeing the slot at the abort: a handler slow to notice its signal would run beside the interactive job on a device that has room for one. | Claude (ruling) |
| How does a caller cancel an interactive job (PRV-061, ARCH-083)? | By aborting the signal it passed to `callStructured` or `streamText`, which then calls `cancel(jobId)`; the queue aborts the `JobContext` signal the work runs under. `InteractiveOptions` takes no signal. | Giving `runInteractive` the caller's signal: the code block's `InteractiveOptions` has none, and one job would have two ways to be cancelled. | Claude (ruling) |
| What does a profile's `timeoutMs` bound (PRV-013)? | Idle time, in every adapter: the wait for the response headers, then each wait for the next chunk of the body. It never bounds the whole call, so a long narration that keeps streaming never times out, and a server that goes quiet fails after `timeoutMs`. | A bound on the whole call: it would cut off a long but healthy stream, or, set high enough for the slowest generation, take that long to notice a dead server. | owner |
| What usage does an adapter report when the provider reports none (PRV-070, PRV-071)? | Each count it leaves out is estimated from the profile's `charsPerToken`, as the mock does, so `TextResponse.usage` is always complete. A cancelled call's usage is always estimated, so P1-T14 does not calibrate from cancelled calls (Open). | Zero for a missing count: calibration would read it as a huge error. Making the counts nullable: a change to the contract for a case the estimate covers. | owner |
| How does Ollama's `tool-call` method work (PRV-023, PRV-030)? | The adapter offers one tool, named after the schema, with the schema as its parameters, and reads the answer from the tool call's arguments. Ollama cannot force a tool, so when the model answers in plain text instead, that text is the answer, and validation (PRV-050) judges it. | Failing a call with no tool call: a model that writes valid JSON as text would fail for no gain. | owner |
| What is a 200 reply an adapter cannot read (PRV-012, PRV-013)? | `provider_unavailable`, retryable, with `httpStatus: null`: a body that is not JSON or does not match the adapter's wire schema, whole or one line or event of a stream, is a provider failure, like an error reported inside a 200 stream. | `provider_rejected`: nothing about the request was refused, and a garbled reply may not happen again. | Claude (ruling) |
| When is `ProviderError.httpStatus` set (PRV-013)? | Only when the status caused the error: 429, other 4xx, and 5xx. A connection failure, a timeout, an abort, an unreadable reply, and an error inside a 200 stream have `null`, even once a 200 has arrived. | The status whenever a response arrived: a cancelled or timed-out stream would report HTTP 200. | Claude (ruling) |
| How are Node's network failures mapped (PRV-013)? | `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `ECONNRESET`, `EPIPE`, `UND_ERR_SOCKET` (a dropped connection), and connect timeouts (`ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`) are `provider_unavailable`, as is any other code. Node's own header and body timeouts (`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, 300 seconds by default, so only a longer `timeoutMs` meets them) are `provider_timeout`. A header `fetch` would refuse to send is `provider_rejected`, caught before sending, because `fetch`'s own error quotes the value, which may be the API key. | Throwing for an unknown code: a TLS or routing failure is still a provider that cannot be reached. | Claude (ruling) |
| How is `retry-after` read (PRV-013)? | Into `details: { retryAfterSeconds }` on every `rate_limited` error, null when the header is absent or unreadable. Seconds may have a fraction and round up. An HTTP date is measured from the injected `TimeSource` and gives 0 once past. Text with no letters that is not a number is unreadable, since `Date.parse` reads "-5" as a date in 2001. | Milliseconds: the header counts seconds. | Claude (ruling) |
| Is an API key trimmed (PRV-005)? | Yes: `resolveApiKey` trims it, since a `.env` file with Windows line endings leaves a `\r` that makes the header invalid. | Using it as stored: the same file would work on macOS and fail on Windows (OVR-001). | Claude (ruling) |
| How does the `<think>` splitter treat what is not a tidy block (PRV-046)? | A block still open at the end is thinking. A stray `</think>` with no `<think>` before it is dropped (Open). Whitespace straight after `</think>` is dropped, since models put a blank line there. The end of a delta that could be the start of a tag is held back until the next delta shows what it is. | Passing a stray `</think>` through: the tag would show in the narration. | Claude (ruling) |
| Which structured-output method does an adapter use (PRV-023, PRV-030, PRV-040)? | For a `json` format, the profile's `structuredOutput`, in every adapter. A `text` format sends no format parameter, whatever the method. The probe forces a method by passing a copy of the profile with that method (PRV-092). | A method chosen per call: the probe (PRV-090) already finds the method that works for each profile. A method field on `TextRequest`: the copied `types.ts` has none (OVR-033). | Claude (ruling) |
| When does an adapter stream (PRV-045)? | Whenever the request has `onDelta`, which then gets every piece of answer text, a tool call's arguments included. Sending the whole text as one delta for a profile with `streaming: false` is `streamText`'s job (P1-T14). | Each adapter reading `profile.streaming`: every adapter would repeat the one-delta fallback. | Claude (ruling) |
| What does an adapter return for a refusal in a 200 reply (PRV-013, CSET-050)? | `ok`, with `finishReason: 'refusal'`, for an OpenAI-compatible `refusal` or `finish_reason: 'content_filter'`. Its text is the answer, or the refusal's own words when there is none, and refusal text never reaches `onDelta`. | `provider_rejected`: the request was accepted and answered, and only the answer says why it was refused. | Claude (ruling) |
| What does a call that fails after some text return (PRV-047)? | Only an abort returns the text so far, as `ok` with `finishReason: 'cancelled'`. Any other failure, such as an error event, a dropped connection, or a timeout, is the error however much text arrived, and an abort with only thinking received is the `cancelled` error. | Keeping the text on every failure: a narration cut off by a fault would be committed as if the player had stopped it. | Claude (ruling) |
| What does the OpenAI-compatible adapter send beyond the messages (PRV-030)? | `max_tokens`; `stream_options.include_usage` when streaming; each sampling value the profile sets, `top_k` and `repeat_penalty` included, which OpenAI lacks but llama.cpp, vLLM, and LM Studio read. No thinking parameter (Open). An `apiKey` goes as a bearer token, in place of any `Authorization` in `headers`. | `max_completion_tokens`, which OpenAI now prefers: not every local server reads it. | Claude (ruling) |
| What does the OpenAI-compatible `tool-call` method do when no tool call comes back (PRV-030)? | It uses the content, as Ollama's does, since some servers ignore `tool_choice`. Only the first tool call counts. | Failing the call: a server that ignores `tool_choice` but writes valid JSON would fail for no gain. | Claude (ruling) |
| When is a streamed reply complete (PRV-012)? | When its body ends cleanly, even without Ollama's `done` line or an OpenAI `finish_reason`: the finish is then `stop`, and missing counts are estimated. A dropped connection is an error. | Requiring the last line: the server has already ended the body, and some servers leave it out. | Claude (ruling) |
| Do adapters log (CONV-070)? | No: they take no logger. A failure returns as a `ProviderError` with a message in plain words, and the caller logs it. | A logger in each adapter: failures would be logged twice, and each adapter would need its own care to keep keys out of logs. | Claude (ruling) |
| How do `health` and `listModels` reach a provider (PRV-091)? | With one GET under a 10-second idle timeout, since no profile gives a `timeoutMs`: Ollama's `/api/version` and `/api/tags`, and an OpenAI-compatible server's `/models` for both. Any error makes `health` unreachable, with the error's message as its detail. The status list's 5-second limit (`health.ts`) applies on top of this idle timeout, to the whole check. | No timeout: a hung server would leave the settings screen waiting. | Claude (ruling) |
| Which API version does the Anthropic adapter send, and what of the profile's sampling (PRV-042)? | `anthropic-version: 2026-10-21`. It never sends `temperature`, `top_p`, or `top_k`, which that version rejects on every model, so Anthropic ignores the profile's and the role's sampling, as the providers README says. | Staying on `2023-06-01` to keep sampling: the newest models accept only their default sampling on any version, and new API features arrive on the new one. | owner |
| What does the Anthropic adapter send for each `thinking` setting (PRV-046)? | `off` sends `{ type: 'disabled' }`, `on` sends `{ type: 'adaptive', display: 'summarized' }`, and `provider-default` leaves the field out. A model that cannot turn thinking off, such as Claude Opus 5.5, Sonnet 5.5, or Fable 5.1, answers `off` with a 400. That is `provider_rejected`, with a message a player can act on: Anthropic's own explanation, then the setting to change, the profile's thinking to `provider-default`. | Sending something else for `off` where a model refuses `disabled`, such as leaving the field out: the profile would think while its setting says off, and the adapter would need a list of models. | owner |
| How does the Anthropic adapter carry out the `tool-call` method (PRV-040)? | One tool named after the schema, with `strict: true`, forced with `tool_choice: { type: 'tool', name }`; the answer is its input. A model that refuses forced tool use, such as Claude Opus 5.5, Sonnet 5.5, or Fable 5.1, answers with a 400, which is `provider_rejected`, so PRV-053 falls back to `prompt-only`, and the probe suggests `json-schema`. | `tool_choice: auto` with the tool named in the prompt: the model could answer without calling it, so the method would no longer guarantee a call. | owner |
| Where do system messages go in an Anthropic request (PRV-041)? | The leading system messages become `system` text blocks. A system message after a user or assistant message throws (CONV-041), since CTX-010 never builds one. | Sending it as a mid-conversation system message: only some models accept one, and nothing in the engine produces it. | Claude (ruling) |
| How does the Anthropic adapter lay out messages that CTX-010 did not foresee (PRV-043)? | More than four breakpoints throws (CONV-041). A message with no visible text is left out, since the API refuses an empty block, and its breakpoint moves to the block before it. | Sending the empty block: every call with one would fail with a 400. | Claude (ruling) |
| How does the Anthropic adapter count usage (PRV-071)? | `inputTokens` is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, and `cachedInputTokens` is `cache_read_input_tokens`; for each count, the latest event that reports it wins. A stream cancelled before its `message_delta` estimates its output tokens from the profile's `charsPerToken`. | `input_tokens` alone: it leaves out the cached prefix (Traps). | Claude (ruling) |
| What `finishReason` does each Anthropic `stop_reason` give? | `max_tokens` and `model_context_window_exceeded` are `length`; `refusal` is `refusal`, returned as `ok` (CSET-050); `end_turn`, `stop_sequence`, `tool_use`, `pause_turn`, and any reason added later are `stop`. | An error for an unknown reason: a new reason would fail calls whose text arrived whole. | Claude (ruling) |
| What is an `error` event in an Anthropic stream (PRV-013)? | It is mapped by its `error.type`: `overloaded_error` and `api_error` are `provider_unavailable`, `rate_limit_error` is `rate_limited` with no wait, `timeout_error` is `provider_timeout`, and any other is `provider_rejected`. It is an error even after text has arrived, as is a body that ends before `message_stop`; only an abort returns partial text (PRV-047). | Returning the partial text as `ok`: the turn would keep narration the provider cut off as if it were complete. | Claude (ruling) |
| Does the Anthropic adapter stream when the profile's `streaming` is false (PRV-045)? | Always: every request sends `stream: true`, so one parser reads every response, and each answer delta goes to `onDelta` whenever one is given. Sending the text as one delta for a profile with streaming off is `streamText`'s job (P1-T14). | A second, unstreamed code path: twice the parsing for the same result. | Claude (ruling) |
| What does the Anthropic adapter keep of thinking (PRV-046)? | The text of `thinking` blocks. Signatures and `redacted_thinking` blocks are dropped, since the engine never sends a model's thinking back, and empty thinking is `null`. Inline `<think>` tags are not looked for: Anthropic's models put thinking in blocks. | Keeping signatures for a later replay: no prompt sends a model's own turn back with its thinking. | Claude (ruling) |
| How does `health` check an Anthropic provider (PRV-091)? | `GET /v1/models?limit=1`, which needs a working key, timed with the `TimeSource`. A 401 or 403 is `reachable: false`, with a message that says to check the key. | A one-token Messages call: it costs money, and it needs a model name, which a provider config does not have. | Claude (ruling) |
| What is an `anthropic` provider's `baseUrl`? | The API's origin without `/v1`, as Anthropic's SDKs take it, and `https://api.anthropic.com` when absent. A trailing slash is ignored. | Including `/v1`, as `openai-compatible` does: an address copied from an Anthropic SDK's settings would lack it. | Claude (ruling) |
| How does the Anthropic adapter tell that a 400 is about thinking (PRV-013)? | It does not: every 400 on a profile whose thinking is `off` gets the hint, worded to fit any 400: "This profile turns thinking off, which some Anthropic models do not allow; if that is the problem, set the profile's thinking to provider-default in Settings." | Matching Anthropic's message text: code never branches on message text (CONV-042), and a rewording would drop the hint with no test failing. | Claude (ruling) |
| Where does the format instruction go (PRV-050 step 3)? | In a system message of its own, right after the prompt's leading system messages. A floor repeated at the end of the task tier (CSET-042) then stays nearest the output, and the instruction, which is the same on every call for one schema and method, stays in the cached prefix. Retry feedback still goes at the end. | A user message after the task tier: the format text, the whole schema for `prompt-only`, would follow the repeated floor, and would be processed again on every call. | owner |
| When does PRV-053 switch to `prompt-only`, and what does the record say? | On any `provider_rejected` from a `json-schema` or `tool-call` request, once per call: code cannot tell a refused schema from another 4xx (CONV-042), and a needless switch costs one call. The switch is not a validation retry, so the call may send four requests. A call that succeeds after it has outcome `fallback`. | Switching only on a schema error: no error code says so. Counting the switch as a retry: a call would lose a validation retry to a provider limit. | Claude (ruling) |
| What does a refusal do (CSET-050)? | `callStructured` returns `provider_rejected`, without a validation retry, since a refusal is no format problem; its message leaves the model's words out, because callers log it (CONV-072). `streamText` returns `ok` with `finishReason: 'refusal'`, and its record's outcome is `failed`. | Feeding a refusal back as a parse error: two more calls that the model would refuse too. | Claude (ruling) |
| What does a model call record hold (PRV-054, ARCH-060)? | One record per call, written when it ends. Each run of the adapter is an attempt, the queue's transient retries (PRV-051) included, with the error in `error` when the provider gave no answer. `messages` are those of the last request sent: the caller's, the format instruction, and each retry's feedback. A call that reaches no model, because its role is unassigned or machine config failed to load, has no record. A campaign that no longer opens is logged and its record dropped; the caller still gets its result. | A record per attempt: the inspector would have to put a call back together. The first request's messages: the retries' feedback would be lost. | Claude (ruling) |
| What is in `model_output_invalid`'s `details` (PRV-050 step 8)? | `{ attempts }`: for each attempt, `attempt`, `method`, `error`, `parseError`, `schemaIssues`, and `semanticIssues`. | The last attempt's problems only: the turn's failure card could not show why the earlier ones failed. | Claude (ruling) |
| What does a profile with `streaming: false` send to `onDelta` (PRV-045)? | One delta, with whatever text came back, partial text after a cancel included, so the deltas always add up to `StreamedText.text`. The adapter gets no `onDelta`. | Nothing after a cancel: the turn would keep text the player never saw. | Claude (ruling) |
| Which roles does `routeRole` fall back for (PRV-001, PRV-009, PRV-015)? | `npc-voice` to the narrator's assignment and `speech-segmenter` to the extractor's. An unassigned `illustrator` is `not_configured`: its fallback is templates, not a model, so its caller (phase 9) checks the role before calling. | Routing the illustrator to another role: no role writes image prompts in its place. | Claude (ruling) |
| What does a role's `sampling` do to its profile's (PRV-001)? | It overrides it key by key: an adjudicator that sets only `temperature` keeps the profile's `presencePenalty`. | Replacing the whole `sampling`: setting one value in a role would quietly drop the profile's others. | Claude (ruling) |
| What does calibration fold in (PRV-071)? | Each attempt the provider answered, unless its `finishReason` is `cancelled`, comparing `estimateTokens` over all the message text sent with the reported `inputTokens`. The call does not wait for the save, and a failed save is logged. | Once per call: a call with retries would calibrate from one of several prompts. Waiting for the save: every call would wait for a file write. | Claude (ruling) |
| What does the Anthropic adaptation do with a constraint it removes (PRV-052)? | Drops it. Zod still checks the answer, and a violation comes back to the model in the retry feedback (PRV-050 step 7). | Copying it into the field's `description`, as Anthropic's SDK helpers do: more text in every schema for a hint the retry already gives. | Claude (ruling) |
| Does the queue retry a probe request (PRV-090, PRV-051)? | No. The probe's work returns every failure with `retryable: false`, so each method gets one try, and a failed method is what the probe reports. | The queue's retries: a transient failure would be hidden, and a probe could wait through 10 seconds of backoff for each method, at the default `maxAttempts`. | owner |
| In what order does the probe send its requests, and how long is the text prompt (PRV-090)? | The tiny structured request with `json-schema`, `tool-call`, then `prompt-only`, and the text request last, so the model is already loaded when its speed is measured. The text prompt is about 1,000 tokens, so processing it takes measurable time. | The text request first, with a short prompt: its speed would include loading the model, and a short prompt is processed too quickly to time. | owner |
| Does the mock answer the probe's structured request (PRV-083, PRV-090)? | Yes: `jsonPlaceholders` holds a placeholder for the `probe` schema, with a test that it parses with the probe's schema, so a mock profile probed with nothing scripted passes every method. | No placeholder: the mock would reject every method, and probing a mock profile in offline UI work would say that nothing works. | owner |
| What is the root of the probe's structured schema (PRV-090, PRV-052)? | An object, as every model-facing schema's is, so the probe tests the methods, not Anthropic's handling of a union root (Open). | A union root, to settle that question: on Anthropic a refusal would read as the method failing, and the probe would suggest a worse one. | owner |
| What does the probe suggest when the model thinks while the profile says `off` (PRV-090)? | Turning thinking off on the server, in its own settings for the model: the profile already says off, so the server is not honouring it. | Suggesting the profile's thinking setting: it already says off. | owner |
| How long does a provider's status wait (PRV-091)? | At most 5 seconds for the whole check (`HEALTH_TIMEOUT_MS` in `health.ts`), timed by the injected `SetTimer`, which then aborts the check. The provider is then unreachable, with a detail in plain words, such as "Ollama at http://localhost:11434 did not answer within 5 seconds." | The adapters' 10-second idle timeout alone: it bounds each wait, not the whole check. | owner |
| How does the status list check providers (PRV-091)? | All at once, returned in config order. A check that throws, as building a `comfyui` adapter does until phase 9, is logged and reported unreachable, so one provider never hides the others' statuses. A config that fails to load returns its error. | One after another: two hung servers would hold the screen for ten seconds. | Claude (ruling) |
| Which of the probe's calls run as jobs (PRV-092)? | Only the model requests. `listModels` is called directly, as `health` is: a GET that needs no slot on the device. | Running the listing as a job too: it would wait behind a narration on the same device, though it uses no model. | Claude (ruling) |
| What does the probe send (PRV-090, PRV-092)? | Each request as the narrator, with the profile's own sampling and `maxOutputTokens`, not the narrator role's overrides, since it tests a profile rather than a role. Every prompt ends its instructions with the hard floor (CSET-040). An embedding profile gets only its listing: reachable and model present. | The narrator role's sampling: a profile probed before any role uses it has none, and two probes of one profile could differ. | Claude (ruling) |
| How does the probe measure speed and pick a method (PRV-090)? | Inside each job, with the `TimeSource`, so time spent queued does not count. Prompt speed is the uncached input tokens over the time to the first answer delta, and generation speed the output tokens over the rest; with thinking, which comes before the first answer delta, only generation speed is given, over the whole call. The fastest valid method has the shortest job, and a tie goes to `json-schema`, then `tool-call`, then `prompt-only`. The text prompt opens with the probe's start time, so a server's prompt cache cannot reuse an earlier probe's prompt. | Timing from the caller: a probe queued behind a narration would look slow. | Claude (ruling) |
| When does the probe stop early (PRV-090)? | When the model list fails: the provider is unreachable, the list's error is the one suggestion, and no model request is sent. Otherwise every request is sent whatever the earlier ones gave; a failed text request leaves both speeds null and adds its message to the suggestions. A model the provider does not list (for Ollama, a name with no tag matches its `:latest`) is reported and the probe goes on, since a server may answer to a name it does not list. A cancel returns `cancelled`. | Stopping at the first failed request: the methods after it would go untested. | Claude (ruling) |
| What do a probe's `suggestions` hold (PRV-090)? | In order: a model the provider does not list; each distinct error message from the provider, once; the method to use or keep, with the reason, or what went wrong with each when none gave valid output; turning thinking off on the server; and a text profile's context window below 8,192 tokens (CTX-032). | One message per request: the same failure, such as Anthropic's thinking hint, would repeat four times. | Claude (ruling) |

## Open

- **The mock's embeddings cannot be scripted or recorded.** `embed` always returns
  deterministic placeholder vectors, whatever the mode (PRV-080, PRV-081). Retrieval
  tests that need chosen similarities arrive in phase 4, which adds scripted and fixture
  embeddings.
- **`resume()` opens every campaign (PRV-062).** It opens each campaign's database at
  server start to read its stored jobs, and the campaign store keeps every connection
  open until shutdown. The queue cannot close one, since it does not know whether
  anything else is using it.
- **Estimated usage still feeds calibration (PRV-071).** An adapter estimates a count
  its provider leaves out from the profile's own `charsPerToken` (Decisions), and
  `TextResponse` does not say which counts are estimates. Calibrating from such a call
  pulls the ratio back toward the profile's own, so a provider that never reports
  usage leaves its profile on its starting ratio. Only cancelled calls are skipped.
- **A stray `</think>` cannot take back streamed text.** Some chat templates open the
  `<think>` block in the prompt, so the model writes its reasoning and then `</think>`
  with no opening tag. By then the reasoning has gone to `onDelta` as answer text; the
  splitter only drops the stray tag (PRV-046, Decisions). Such a model needs a server
  that returns reasoning in a field of its own, as Ollama does with `think`, and as
  llama.cpp's `--reasoning-format` and LM Studio's reasoning setting can.
- **The OpenAI-compatible adapter sends no thinking parameter.** Servers name it
  differently (`reasoning_effort`, `chat_template_kwargs.enable_thinking`, OpenRouter's
  `reasoning`), so `profile.thinking` has no effect there; reasoning that does come back
  is still captured (PRV-046). The probe (PRV-090) reports whether thinking was emitted.
- **The local adapters have no `embedding` member.** Ollama and OpenAI-compatible
  servers both serve embedding models, but `embed` arrives with retrieval in phase 4;
  until then only the mock embeds (PRV-010).
- **No `anthropic-workspace-id`.** Anthropic's `anthropic-workspace-id` header picks the
  workspace for a credential that can act on more than one. An `anthropic` provider has no
  field for it, so the adapter never sends it; adding one changes `ProviderConfigSchema`.
- **Limits the Anthropic adaptation cannot fix (PRV-052, PRV-053).** A request may hold
  at most 20 strict tools, 24 optional parameters, and 16 parameters with union types
  (an `anyOf` or a type array such as `["string", "null"]`), across all its strict
  schemas, and refuses recursive schemas and complex regex quantifiers. Removing any of
  these would change what the schema means, so such a schema is sent as it is, refused
  with a 400, and retried as `prompt-only`.
- **A union at the root of an Anthropic schema is unverified (PRV-052).** The ruling's
  schema is a discriminated union, so its root becomes an `anyOf`. Anthropic's
  structured-outputs page, read 2026-11-06, shows only object roots and says nothing
  about a union root. If it is refused, PRV-053 falls back to `prompt-only`; the first
  real adjudication call (phase 3) will show it. The settings probe keeps an object root
  (Decisions), so it cannot; a one-off manual probe with a union-root schema could settle
  it sooner.
- **A ComfyUI provider's model list is `internal_error` (PRV-091).** `createAdapter`
  throws for `comfyui` until phase 9, so `GET /settings/providers/:providerId/models` for
  one answers `internal_error`, where its status is reported unreachable.
- **A pending restart is forgotten on reload (PRV-004).** Only `PUT /settings` answers
  `restartRequired`; `GET /settings` does not say whether the saved config still differs
  from the one the server started with. The settings screen shows its restart notice after
  such a save, and loses it when the page reloads; the address, port, and data folder
  always say they need a restart (14-ui Decisions, owner). Adding the flag to the GET
  answer would need a contract change.
- **The last save wins (PRV-003).** `PUT /settings` replaces the whole config and checks
  nothing about what the saving device last read, so when two devices edit settings at
  once, the later save quietly undoes the other's changes.
