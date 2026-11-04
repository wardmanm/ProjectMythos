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
