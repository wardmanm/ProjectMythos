import { z } from 'zod';
import { EntityIdSchema, IdSchema } from './primitives';
import { ClockIdSchema, HarmLevelSchema, StatIdSchema, StatusTagSchema } from './rules';

/*
 * Read models for the play screen's panels (14-ui §6). Always from the PC's point of view:
 * display names (JRN-020), visible appearance (GEAR-060), and visible clocks only, unless
 * the request is made in GM mode.
 */

export const PresentCharacterSchema = z.object({
  entityId: EntityIdSchema,
  displayName: z.string(),
  appearance: z.string(), // GEAR-062
  isPc: z.boolean(),
});

export const ClockViewSchema = z.object({
  id: ClockIdSchema,
  name: z.string(),
  segments: z.int(),
  filled: z.int(),
  completed: z.boolean(),
  hidden: z.boolean(), // a GM clock; present only in GM mode
});

export const SceneViewSchema = z.object({
  sceneId: IdSchema,
  placeId: EntityIdSchema,
  placeName: z.string(),
  gameTimeLabel: z.string(),
  timeOfDay: z.string(),
  present: z.array(PresentCharacterSchema), // in order of joining the scene (CTX-012)
  clocks: z.array(ClockViewSchema),
  timeUntil: z.array(z.object({ name: z.string(), minutes: z.int().positive() })), // TIME-021
});
export type SceneView = z.infer<typeof SceneViewSchema>;

export const StatusViewSchema = z.object({
  id: IdSchema,
  name: z.string(),
  tags: z.array(StatusTagSchema),
  treated: z.boolean(),
  permanent: z.boolean(),
  healsIn: z.string().nullable(), // e.g. "about 2 days"; null if it will not heal on its own
});

export type ItemView = {
  entityId: string;
  name: string;
  quantity: number;
  concealed: boolean; // GEAR-030: hidden from others
  container: { capacity: number; used: number; items: ItemView[] } | null;
};
export const ItemViewSchema: z.ZodType<ItemView> = z.lazy(() =>
  z.object({
    entityId: EntityIdSchema,
    name: z.string(),
    quantity: z.int().positive(),
    concealed: z.boolean(),
    container: z
      .object({ capacity: z.int(), used: z.int(), items: z.array(ItemViewSchema) })
      .nullable(),
  }),
);

export const CharacterSheetSchema = z.object({
  entityId: EntityIdSchema,
  displayName: z.string(),
  stats: z.array(
    z.object({ id: StatIdSchema, name: z.string(), abbreviation: z.string(), rating: z.int() }),
  ),
  /** One row per ruleset harm level, least severe first, with capacity for empty slots. */
  harm: z.array(
    z.object({
      level: HarmLevelSchema,
      levelName: z.string(),
      capacity: z.int().nullable(),
      statuses: z.array(StatusViewSchema),
    }),
  ),
  conditions: z.array(StatusViewSchema), // non-harm statuses
  permanent: z.array(StatusViewSchema), // lasting conditions (RUL-104)
  gear: z.object({
    slots: z.array(
      z.object({
        slotId: z.string(),
        name: z.string(),
        covered: z.boolean(), // hidden by another worn item (GEAR-003)
        layers: z.array(
          z.object({
            name: z.string(),
            visibility: z.enum(['visible', 'concealed']),
            items: z.array(ItemViewSchema),
          }),
        ),
      }),
    ),
    held: z.array(ItemViewSchema),
    carried: z.array(ItemViewSchema), // encumbrance mode only
    load: z.object({ load: z.number(), capacity: z.number() }).nullable(),
  }),
});
export type CharacterSheet = z.infer<typeof CharacterSheetSchema>;
