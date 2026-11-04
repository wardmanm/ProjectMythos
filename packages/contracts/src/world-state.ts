import { z } from 'zod';
import { EntityIdSchema, GameTimeSchema, IdSchema } from './primitives';
import { EntitySchema } from './entities';
import { ClockSchema } from './rules';

export const FlagValueSchema = z.union([z.boolean(), z.number(), z.string().max(200)]);

/**
 * Current mutable facts at a turn on a branch. Produced only by applying commits
 * (`applyCommit` in core). Memory data (observations, grants, relationships, wiki)
 * lives in projections, not here.
 */
export const WorldStateSchema = z.object({
  gameTime: GameTimeSchema,
  sceneId: IdSchema,
  scenePlaceId: EntityIdSchema,
  pcId: EntityIdSchema,
  entities: z.record(EntityIdSchema, EntitySchema),
  clocks: z.record(z.string(), ClockSchema), // keyed by ClockId
  flags: z.record(z.string(), FlagValueSchema),
});
export type WorldState = z.infer<typeof WorldStateSchema>;
