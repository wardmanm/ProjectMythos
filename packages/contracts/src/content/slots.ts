import { z } from 'zod';
import { ContentSchemaVersionSchema, SlugSchema, SlotSchemaIdSchema } from './common';

export const LayerDefinitionSchema = z.strictObject({
  name: z.string().min(1).max(40), // e.g. "outer", "under"
  visibility: z.enum(['visible', 'concealed']),
});

export const SlotDefinitionSchema = z.strictObject({
  id: SlugSchema, // e.g. "torso"
  name: z.string().min(1).max(40),
  /** Ordered outermost first. Layer index 0 is the outermost. */
  layers: z.array(LayerDefinitionSchema).min(1).max(5),
  itemsPerLayer: z.int().min(1).max(5).default(1),
});

export const SlotSchemaDefinitionSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: SlotSchemaIdSchema,
  name: z.string().min(1).max(80),
  slots: z.array(SlotDefinitionSchema).min(1),
  /** How many items a character can hold in hand at once. */
  heldItems: z.int().min(0).max(4).default(2),
});
export type SlotSchemaDefinition = z.infer<typeof SlotSchemaDefinitionSchema>;
