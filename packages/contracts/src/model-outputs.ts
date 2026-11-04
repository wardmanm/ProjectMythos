import { z } from 'zod';
import { EntityIdSchema } from './primitives';

/*
 * Small model-facing output schemas used by 09-context (CON-003, CON-004).
 * Rulings are in ruling.ts and extraction in extraction.ts.
 */

/** What a key NPC says and does this turn, written from their knowledge only (CTX §6). */
export const NpcVoiceSchema = z.object({
  lines: z
    .array(
      z.object({
        says: z.string().max(600), // empty when the character only acts
        does: z.string().max(300).nullable(), // visible action or manner, e.g. "looks away"
      }),
    )
    .min(1)
    .max(4),
});
export type NpcVoice = z.infer<typeof NpcVoiceSchema>;

/** Voiced lines handed to the narrator, attributed to their speaker. */
export type VoicedLines = { speakerId: z.infer<typeof EntityIdSchema>; voice: NpcVoice };

/** Suggested actions (TRN-059), in the player's voice. */
export const SuggestionsSchema = z.object({
  suggestions: z.array(z.string().min(1).max(160)).min(1).max(6),
});

/** Consolidation output (MEM-104, MEM-107). Group and page indices refer to the prompt. */
export const ConsolidationOutputSchema = z.object({
  summaries: z.array(
    z.object({ groupIndex: z.int().nonnegative(), text: z.string().min(1).max(1000) }),
  ),
  pages: z.array(
    z.object({
      pageIndex: z.int().nonnegative(),
      sections: z
        .array(z.object({ heading: z.string().min(1).max(80), body: z.string().min(1).max(1500) }))
        .max(6),
    }),
  ),
});
