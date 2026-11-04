import { z } from 'zod';
import { EntityIdSchema, IdSchema, WallTimeSchema } from './primitives';

/*
 * Media (15-media). Assets are campaign-level, not branch-scoped and not commits: no game
 * state derives from them (MED-010). Files live in <campaign>/assets/.
 */

export const AssetPurposeSchema = z.enum(['portrait', 'place', 'scene', 'item', 'speech']);

export const AssetSchema = z.object({
  id: IdSchema,
  kind: z.enum(['image', 'audio']),
  purpose: AssetPurposeSchema,
  subjectId: EntityIdSchema.nullable(), // the character, place, or item shown
  sceneId: IdSchema.nullable(), // scene illustrations
  turnId: IdSchema.nullable(), // speech: the turn whose narration it reads
  activeVersionId: IdSchema.nullable(),
  createdAt: WallTimeSchema,
});
export type Asset = z.infer<typeof AssetSchema>;

export const AssetVersionSchema = z.object({
  id: IdSchema,
  assetId: IdSchema,
  file: z.string().regex(/^[a-z0-9\-/]+\.(png|jpg|webp|mp3|opus|wav)$/), // relative to the campaign's assets folder
  mime: z.string(),
  bytes: z.int().nonnegative(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  durationMs: z.int().positive().nullable(),
  prompt: z.string(), // image prompt, or the spoken text
  negativePrompt: z.string(),
  seed: z.int().nullable(),
  profileId: z.string(), // the machine's media profile that made it (informational)
  voiceId: z.string().nullable(), // speech
  sourceSetId: IdSchema.nullable(), // speech: the narration set it was made from (MED-056)
  createdAt: WallTimeSchema,
});
export type AssetVersion = z.infer<typeof AssetVersionSchema>;

// ------------------------------------------------------------------- ComfyUI (MED §4)

const NodeInputSchema = z.strictObject({ node: z.string().min(1), input: z.string().min(1) });

/**
 * Machine-level file in <dataDir>/library/workflows/<name>.mapping.json. Says where each
 * engine parameter goes in an API-format workflow exported from ComfyUI.
 */
export const WorkflowMappingSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(80),
  workflowFile: z.string().regex(/^[\w\-.]+\.json$/), // API-format export, beside the mapping
  inputs: z.strictObject({
    prompt: NodeInputSchema,
    negativePrompt: NodeInputSchema.optional(),
    seed: NodeInputSchema.optional(),
    width: NodeInputSchema.optional(),
    height: NodeInputSchema.optional(),
    loraName: NodeInputSchema.optional(),
    loraStrength: NodeInputSchema.optional(),
    referenceImage: NodeInputSchema.optional(), // a LoadImage node's "image" input
  }),
  output: z.strictObject({ node: z.string().min(1) }), // the SaveImage node to read
});
export type WorkflowMapping = z.infer<typeof WorkflowMappingSchema>;

// ------------------------------------------------------------------- model-facing (CON-003)

/** Illustrator output (MED §3.3). */
export const IllustrationPromptSchema = z.object({
  prompt: z.string().min(1).max(1500),
  negativePrompt: z.string().max(500),
});

/** Speech segmenter output (MED §5.3): the narration, split by who is speaking. */
export const SpeechSegmentsSchema = z.object({
  segments: z
    .array(
      z.object({
        speaker: z.union([z.literal('narrator'), EntityIdSchema]),
        text: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(80),
});
export type SpeechSegments = z.infer<typeof SpeechSegmentsSchema>;

// ------------------------------------------------------------------- campaign settings & commands

/** Stored in campaign_state, like content settings (CSET-020). */
export const CampaignMediaSettingsSchema = z.object({
  illustrate: z.object({
    portraits: z.enum(['manual', 'on-first-meeting']),
    places: z.enum(['manual', 'on-first-visit']),
    scenes: z.enum(['manual', 'on-scene-start']),
  }),
  sceneImagesInStory: z.boolean(),
  speech: z.enum(['off', 'narrator', 'character-voices']),
});
export type CampaignMediaSettings = z.infer<typeof CampaignMediaSettingsSchema>;

export const GenerateImageCommandSchema = z.object({
  purpose: z.enum(['portrait', 'place', 'scene', 'item']),
  subjectId: EntityIdSchema.nullable(),
  sceneId: IdSchema.nullable(),
  promptOverride: z.string().min(1).max(1500).optional(), // the player's edited prompt
  seed: z.int().nonnegative().optional(), // reuse a seed to vary only the prompt
});

/** A player's choice of voice for one speaker on this machine (MED-052). */
export const VoiceAssignmentSchema = z.object({
  speechProfileId: z.string(),
  speakerId: z.union([z.literal('narrator'), EntityIdSchema]),
  voiceId: z.string().min(1),
});
