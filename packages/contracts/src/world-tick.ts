import { z } from 'zod';
import {
  EntityRefSchema,
  ObservationHandleSchema,
  ObservationRefSchema,
  makeExtractionSchemas,
  type ExtractionLimits,
} from './extraction';

/*
 * World tick output (12-time-world §5.5). Model-facing (CON-003, CON-004). It extends the
 * extraction output: every event names its place and day, and ticks may spread rumors,
 * change goals, and kill NPCs. Statuses and clocks are always allowed (world-tick stage).
 */

export type WorldTickLimits = ExtractionLimits & { periodDays: number };

export function makeWorldTickSchemas(limits: WorldTickLimits) {
  const ex = makeExtractionSchemas({ ...limits, narrativeStatuses: true, narrativeClocks: true });
  const observation = ex.observation.extend({
    placeId: EntityRefSchema, // required off-screen: where it happened
    day: z.int().min(1).max(Math.max(1, limits.periodDays)), // day of the period it happened on
  });
  const worldTick = ex.extraction.omit({ observations: true }).extend({
    /** One short paragraph: what happened off-screen this period. Shown in GM mode. */
    summary: z.string().min(1).max(800),
    observations: z.array(observation).max(24),
    /** A claim spreading secondhand: the reached characters learn it as rumor (MEM-035). */
    rumors: z
      .array(
        z.object({
          claim: z.union([ObservationRefSchema, ObservationHandleSchema]),
          reachedIds: z.array(EntityRefSchema).min(1).max(12),
        }),
      )
      .max(8),
    goalUpdates: z
      .array(
        z.object({
          characterId: EntityRefSchema,
          goals: z.array(z.string().min(1).max(200)).max(8), // the full new list
          reason: z.string().min(1).max(300),
        }),
      )
      .max(8),
    deaths: z
      .array(z.object({ characterId: EntityRefSchema, cause: z.string().min(1).max(300) }))
      .max(3),
  });
  return { observation, worldTick };
}

const broad = makeWorldTickSchemas({
  statIds: null,
  rating: { min: -5, max: 20 },
  tagIds: null,
  maxHarmLevel: 9,
  dimensionIds: null,
  maxRelationshipChange: 100,
  narrativeStatuses: true,
  narrativeClocks: true,
  periodDays: 400,
});
export const WorldTickSchema = broad.worldTick;
export type WorldTick = z.infer<typeof WorldTickSchema>;
