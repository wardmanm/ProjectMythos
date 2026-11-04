import { z } from 'zod';
import { EntityIdSchema } from '../primitives';
import { ContentSchemaVersionSchema, ScenarioIdSchema } from './common';
import { CalendarDateSchema } from './calendar';

export const ScenarioSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: ScenarioIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(1000), // shown in the new-campaign wizard
  start: CalendarDateSchema,
  startPlaceId: EntityIdSchema,
  /** Markdown file (relative to the pack): the opening situation, shown to the narrator (SCH-073). */
  openingFile: z.string().regex(/^[a-z0-9\-/]+\.md$/),
  presentEntityIds: z.array(EntityIdSchema),
  pc: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('premade'), characterId: EntityIdSchema }),
    z.strictObject({
      mode: z.literal('player-created'),
      /** Guidance shown to the player and the GM, e.g. "a newcomer to town". */
      concept: z.string().max(600),
    }),
    z.strictObject({
      mode: z.literal('either'),
      characterId: EntityIdSchema,
      concept: z.string().max(600),
    }),
  ]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
