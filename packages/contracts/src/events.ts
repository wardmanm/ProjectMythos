import { z } from 'zod';
import { IdSchema, EntityIdSchema } from './primitives';
import { ResolutionDraftSchema } from './turn-api';
import { TurnStatusSchema } from './turns';
import { JobSchema } from './models';
import { AppErrorSchema } from './errors';

/** Server-to-client event payloads (ARCH-092). */
export const ServerEventPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('turn.status'), turnId: IdSchema, status: TurnStatusSchema }),
  z.object({ type: z.literal('turn.created'), branchId: IdSchema, turnId: IdSchema }),
  z.object({ type: z.literal('resolution.ready'), draft: ResolutionDraftSchema }),
  z.object({
    type: z.literal('narration.delta'),
    turnId: IdSchema,
    offset: z.int().nonnegative(), // where `text` starts in the narration (UI-101)
    text: z.string(),
  }),
  z.object({ type: z.literal('narration.done'), turnId: IdSchema }),
  z.object({
    type: z.literal('state.changed'),
    turnId: IdSchema,
    commitSetId: IdSchema,
    affectedEntityIds: z.array(EntityIdSchema), // client invalidates these queries
  }),
  z.object({
    type: z.literal('branch.changed'), // head moved: fork, rewind, rewrite, copy-on-write
    branchId: IdSchema,
    headTurnId: IdSchema,
  }),
  z.object({ type: z.literal('job.updated'), job: JobSchema }),
  z.object({ type: z.literal('error'), turnId: IdSchema.nullable(), error: AppErrorSchema }),
  z.object({ type: z.literal('resync.required') }), // replay buffer no longer covers the gap
]);
export type ServerEventPayload = z.infer<typeof ServerEventPayloadSchema>;

export const ServerEventSchema = z.object({
  id: z.int().nonnegative(), // monotonically increasing per server process (ARCH-091)
  campaignId: IdSchema,
  payload: ServerEventPayloadSchema,
});
export type ServerEvent = z.infer<typeof ServerEventSchema>;
