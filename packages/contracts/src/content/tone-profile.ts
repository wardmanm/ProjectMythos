import { z } from 'zod';
import {
  ContentSchemaVersionSchema,
  SlotSchemaIdSchema,
  ThemeIdSchema,
  ToneProfileIdSchema,
} from './common';

export const IntensityLevelSchema = z.enum(['off', 'fade-to-black', 'moderate', 'explicit']);
export type IntensityLevel = z.infer<typeof IntensityLevelSchema>;

/** Behavior of each category is defined in 13-content-settings. The hard floor is not configurable. */
export const ContentSettingsSchema = z.strictObject({
  violence: IntensityLevelSchema,
  gore: IntensityLevelSchema,
  sexual: IntensityLevelSchema,
  language: IntensityLevelSchema,
  disturbing: IntensityLevelSchema,
  lines: z.array(z.string().min(1).max(200)), // never appears
  veils: z.array(z.string().min(1).max(200)), // happens off-page
});
export type ContentSettings = z.infer<typeof ContentSettingsSchema>;

export const ToneProfileSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: ToneProfileIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  genre: z.string().min(1).max(120), // e.g. "low fantasy mystery"
  tone: z.string().min(1).max(600), // free prose: mood, feel, touchstones
  themes: z.array(z.string().min(1).max(80)),
  narration: z.strictObject({
    perspective: z.enum(['second-person', 'third-person']),
    tense: z.enum(['present', 'past']),
    length: z.enum(['brief', 'standard', 'rich']),
    style: z.string().max(600), // prose-style guidance for the narrator
  }),
  pacing: z.enum(['slow', 'standard', 'fast']),
  content: ContentSettingsSchema,
  /** Overrides the setting's slot schema when present. */
  slotSchemaId: SlotSchemaIdSchema.optional(),
  /** The campaign's look (14-ui §3). Absent = the house theme. */
  themeId: ThemeIdSchema.optional(),
  /** Reserved for phase 9 image prompts. */
  artStyle: z.string().max(600).optional(),
  /** When the profile was built from free text, the original text is kept here. */
  sourceText: z.string().max(8000).optional(),
});
export type ToneProfile = z.infer<typeof ToneProfileSchema>;
