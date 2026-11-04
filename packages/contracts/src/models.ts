import { z } from 'zod';
import { IdSchema, WallTimeSchema } from './primitives';

export const ModelRoleSchema = z.enum([
  'adjudicator',
  'narrator',
  'npc-voice',
  'extractor',
  'consolidator',
  'world-ticker',
  'embedder',
  'illustrator', // writes image prompts (MED §3.3)
  'speech-segmenter', // splits narration by speaker (MED §5.3)
]);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

/** Provider kinds (ARCH-133). */
export const ProviderKindSchema = z.enum([
  'text',
  'embedding',
  'image',
  'speech-output',
  'speech-input',
]);

/** Job priority, highest first (ARCH-080). */
export const JobPrioritySchema = z.enum([
  'interactive',
  'extraction',
  'world-tick',
  'consolidation',
  'media',
]);
export type JobPriority = z.infer<typeof JobPrioritySchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);

/** Queue-visible job record. Payloads are defined per job type in 05-providers. */
export const JobSchema = z.object({
  id: IdSchema,
  type: z.string().min(1), // e.g. 'extraction', 'world-tick'
  priority: JobPrioritySchema,
  deviceId: z.string().min(1),
  status: JobStatusSchema,
  attempts: z.int().nonnegative(),
  turnId: IdSchema.nullable(),
  createdAt: WallTimeSchema,
  updatedAt: WallTimeSchema,
});
export type Job = z.infer<typeof JobSchema>;
