import { z } from 'zod';
import { EntityIdSchema, IdSchema, WallTimeSchema } from './primitives';
import { StatBlockSchema, StatIdSchema, StatusTagSchema } from './rules';
import { AgeCategorySchema } from './entities';
import { RetrievedObservationSchema } from './memory';
import { ModelRoleSchema } from './models';
import { MachineConfigSchema, StructuredOutputMethodSchema } from './machine-config';
import {
  PackIdSchema,
  RulesetIdSchema,
  ScenarioIdSchema,
  ThemeIdSchema,
  ToneProfileIdSchema,
} from './content/common';
import { ContentSettingsSchema } from './content/tone-profile';
import { ThemeSchema } from './content/theme';

/*
 * Requests and responses outside a running turn: the library, campaign creation,
 * machine settings, the PIN session, and model call records. Routes: 03-contracts §14.2.
 */

// ---------------------------------------------------------------- library

/** One problem found while loading a pack (SCH-100, SCH-101). */
export const PackIssueSchema = z.object({
  file: z.string(), // pack-relative, forward slashes
  path: z.string(), // JSON path within the file; empty for the file as a whole
  message: z.string(),
});

const OptionSchema = z.object({ name: z.string(), description: z.string() });

export const PackSummarySchema = z.object({
  packId: PackIdSchema,
  name: z.string(),
  version: z.string(),
  description: z.string(),
  settingName: z.string().nullable(), // null when setting.json failed to load
  scenarios: z.array(
    OptionSchema.extend({
      id: ScenarioIdSchema,
      pcMode: z.enum(['premade', 'player-created', 'either']),
      premadePc: z.object({ id: EntityIdSchema, name: z.string() }).nullable(),
    }),
  ),
  /** What this pack can use: its own definitions, then the libraries' (SCH-010). */
  toneProfiles: z.array(OptionSchema.extend({ id: ToneProfileIdSchema })),
  rulesets: z.array(OptionSchema.extend({ id: RulesetIdSchema })),
  defaults: z.object({
    toneProfileId: ToneProfileIdSchema.nullable(),
    rulesetId: RulesetIdSchema, // ruleset.standard when the setting names none (SCH-114)
  }),
  issues: z.array(PackIssueSchema), // any issue blocks campaign creation (SCH-102)
});
export type PackSummary = z.infer<typeof PackSummarySchema>;

// ---------------------------------------------------------------- campaigns

/** Maps a pack's characters onto a ruleset with other stats or harm tags (SCH-114). */
export const StatConversionSchema = z.object({
  stats: z.record(
    StatIdSchema, // a stat of the campaign's ruleset
    z.union([
      z.object({ fromStat: StatIdSchema }), // rescaled from the old range, rounded
      z.object({ fixed: z.int() }),
    ]),
  ),
  harmTags: z.record(StatusTagSchema, StatusTagSchema), // old tag → new tag
});

export const CreateCampaignCommandSchema = z.object({
  name: z.string().trim().min(1).max(80),
  packId: PackIdSchema,
  scenarioId: ScenarioIdSchema,
  toneProfileId: ToneProfileIdSchema,
  rulesetId: RulesetIdSchema,
  /** Absent = the tone profile's settings (CSET-020). */
  contentSettings: ContentSettingsSchema.optional(),
  themeId: ThemeIdSchema.optional(), // absent = the tone profile's theme, else theme.house
  conversion: StatConversionSchema.nullable().default(null), // required when stats differ
  pc: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('premade') }),
    z.object({
      mode: z.literal('created'), // takes the premade PC's place in `either` (SCH-115)
      name: z.string().trim().min(1).max(120),
      ageCategory: AgeCategorySchema,
      age: z.int().nonnegative().optional(),
      stats: StatBlockSchema, // checked against the ruleset's pcCreation (SCH-072)
      physicalDescription: z.string().max(1000),
      personality: z.string().min(1).max(600),
    }),
  ]),
});
export type CreateCampaignCommand = z.infer<typeof CreateCampaignCommandSchema>;

export const CampaignSummarySchema = z.object({
  campaignId: IdSchema,
  name: z.string(),
  settingName: z.string(),
  gameTimeLabel: z.string(), // at the current branch head, in the campaign's calendar
  lastPlayedAt: WallTimeSchema,
  themeId: ThemeIdSchema,
  contentSettings: ContentSettingsSchema, // shown in the library (CSET-023)
});
export type CampaignSummary = z.infer<typeof CampaignSummarySchema>;

/** Everything the play screen needs to open a campaign. */
export const CampaignViewSchema = CampaignSummarySchema.extend({
  packId: PackIdSchema,
  rulesetId: RulesetIdSchema,
  pcId: EntityIdSchema,
  currentBranchId: IdSchema, // TRN-101
  headTurnId: IdSchema,
  theme: ThemeSchema, // resolved, so the client can apply it at once (UI-032)
});
export type CampaignView = z.infer<typeof CampaignViewSchema>;

// ---------------------------------------------------------------- settings

/**
 * Inline secrets and the PIN hash never leave the server (PRV-005). Responses put this
 * marker in their place, and a save that sends it back keeps the stored value.
 */
export const SECRET_PLACEHOLDER = '__unchanged__';

export const SaveSettingsResultSchema = z.object({
  config: MachineConfigSchema, // as saved, secrets replaced by the placeholder
  restartRequired: z.boolean(), // `server` or `dataDir` changed (PRV-004)
});

export const ProviderHealthSchema = z.object({
  reachable: z.boolean(),
  latencyMs: z.number().nonnegative().nullable(),
  detail: z.string(), // plain words, e.g. "Ollama is not running on localhost:11434"
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const ProviderStatusSchema = z.object({
  providerId: z.string(),
  health: ProviderHealthSchema,
});

/** The result of probing a model profile (PRV-090). */
export const ProbeResultSchema = z.object({
  profileId: z.string(),
  reachable: z.boolean(),
  modelPresent: z.boolean(),
  structuredMethods: z.partialRecord(StructuredOutputMethodSchema, z.boolean()), // valid output?
  promptTokensPerSecond: z.number().nullable(),
  generationTokensPerSecond: z.number().nullable(),
  emittedThinking: z.boolean(),
  suggestions: z.array(z.string()), // e.g. "Use tool-call: json-schema output did not parse"
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const SetPinCommandSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4,12}$/)
    .nullable(), // null removes the PIN lock
  localhostExempt: z.boolean().default(true), // ARCH-111
});

// ---------------------------------------------------------------- session (ARCH-110)

export const SessionStateSchema = z.object({
  pinRequired: z.boolean(), // false when no PIN is set, or for an exempt localhost
  authenticated: z.boolean(),
});

export const PinLoginCommandSchema = z.object({ pin: z.string().min(1).max(12) });

// ---------------------------------------------------------------- model call records

/** One message in a prompt. The context module produces these (09-context). */
export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
  /**
   * Marks the end of the stable, cacheable prefix. Adapters that support explicit
   * caching (Anthropic) place a cache breakpoint here; others ignore it.
   */
  cacheBreakpoint: z.boolean().optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const TokenUsageSchema = z.object({
  inputTokens: z.int().nonnegative(),
  outputTokens: z.int().nonnegative(),
  cachedInputTokens: z.int().nonnegative().nullable(), // null when not reported
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/** Prompt tiers, most stable first (CTX §3). Order is fixed. */
export const TierSchema = z.enum([
  'instructions',
  'world',
  'scene',
  'transcript',
  'state',
  'knowledge',
  'turn',
  'task',
]);
export type Tier = z.infer<typeof TierSchema>;

/** What the inspector shows for each tier of a built prompt (CTX-090). */
export const TierReportSchema = z.object({
  tier: TierSchema,
  budget: z.int().nonnegative(),
  estimatedTokens: z.int().nonnegative(),
  trimmed: z.array(z.string()), // what was left out to fit, e.g. "2 memories of npc.odette"
  cachedPrefix: z.boolean(), // part of the stable prefix, before a cache breakpoint
});
export type TierReport = z.infer<typeof TierReportSchema>;

/** A problem found after output parsed and matched its schema (CON-005). */
export const SemanticIssueSchema = z.object({ path: z.string(), message: z.string() });
export type SemanticIssue = z.infer<typeof SemanticIssueSchema>;

/** One attempt within a model call. A call with retries has several. */
export const ModelCallAttemptSchema = z.object({
  attempt: z.int().min(1),
  method: z.enum(['json-schema', 'tool-call', 'prompt-only', 'text']),
  rawOutput: z.string(),
  thinking: z.string().nullable(),
  parseError: z.string().nullable(),
  schemaIssues: z.array(z.string()),
  semanticIssues: z.array(SemanticIssueSchema),
  usage: TokenUsageSchema.nullable(),
  durationMs: z.int().nonnegative(),
});
export type ModelCallAttempt = z.infer<typeof ModelCallAttemptSchema>;

/** Stored per model call; the inspector shows it (ARCH-060, CTX-090). */
export const ModelCallRecordSchema = z.object({
  id: IdSchema,
  campaignId: IdSchema,
  turnId: IdSchema.nullable(),
  role: ModelRoleSchema,
  providerId: z.string(),
  profileId: z.string(),
  model: z.string(),
  messages: z.array(ChatMessageSchema),
  tiers: z.array(TierReportSchema),
  retrieved: z.array(RetrievedObservationSchema), // with reasons and score parts (MEM-078)
  templates: z.array(z.string()), // template and partial files used, with their layer
  attempts: z.array(ModelCallAttemptSchema),
  outcome: z.enum(['success', 'fallback', 'failed', 'cancelled']),
  createdAt: WallTimeSchema,
});
export type ModelCallRecord = z.infer<typeof ModelCallRecordSchema>;

/** One row of the inspector's call list (UI-090). */
export const ModelCallSummarySchema = ModelCallRecordSchema.pick({
  id: true,
  turnId: true,
  role: true,
  model: true,
  outcome: true,
  createdAt: true,
}).extend({
  durationMs: z.int().nonnegative(), // all attempts
  inputTokens: z.int().nonnegative().nullable(), // last attempt; null if not reported
  outputTokens: z.int().nonnegative().nullable(),
  attempts: z.int().min(1),
});
export type ModelCallSummary = z.infer<typeof ModelCallSummarySchema>;
