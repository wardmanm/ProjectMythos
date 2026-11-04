import { z } from 'zod';
import { EntityIdSchema } from '../primitives';
import { StatBlockSchema, HarmLevelSchema, StatusTagSchema } from '../rules';
import {
  AgeCategorySchema,
  ContainerSchema,
  EntityMediaSchema,
  ItemBonusSchema,
  ItemLocationSchema,
  ItemSizeSchema,
  VoiceProfileSchema,
} from '../entities';

/*
 * Authoring formats. The loader converts these into runtime entities (03-contracts)
 * at campaign creation. Canon prose for an entity lives in a Markdown file with the
 * same base name, e.g. `characters/npc.varek.json` + `characters/npc.varek.md`.
 */

const AuthoredBase = {
  id: EntityIdSchema,
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().max(120)).default([]),
  tags: z.array(z.string().max(40)).default([]),
  media: EntityMediaSchema.optional(), // MED §3
};

export const AuthoredStatusSchema = z.strictObject({
  name: z.string().min(1).max(80),
  kind: z.enum(['harm', 'condition']),
  level: HarmLevelSchema.optional(),
  tags: z.array(StatusTagSchema),
  note: z.string().max(500).optional(),
});

export const AuthoredCharacterSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.enum(['pc', 'npc']),
  ageCategory: AgeCategorySchema,
  age: z.int().nonnegative().optional(),
  stats: StatBlockSchema,
  physicalDescription: z.string().max(1000),
  /** Short, always-in-context summary of how this character behaves. Longer detail goes in canon Markdown. */
  personality: z.string().min(1).max(600),
  /** Drives world ticks: characters with goals are active NPCs (12-time-world). */
  goals: z.array(z.string().min(1).max(200)).max(8).default([]),
  /** Always voiced by a separate call that sees only this character's knowledge (CTX §6). */
  keyNpc: z.boolean().default(false),
  voice: VoiceProfileSchema.optional(), // MED §5
  startingLocationId: EntityIdSchema.nullable(),
  startingStatuses: z.array(AuthoredStatusSchema).default([]),
});
export type AuthoredCharacter = z.infer<typeof AuthoredCharacterSchema>;

export const AuthoredPlaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.literal('place'),
  parentPlaceId: EntityIdSchema.nullable(),
  description: z.string().max(2000),
});

export const AuthoredFactionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.literal('faction'),
  description: z.string().max(2000),
  goals: z.array(z.string().min(1).max(200)).max(8).default([]),
});

export const AuthoredItemSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.literal('item'),
  description: z.string().max(1000),
  startingLocation: ItemLocationSchema,
  ownerId: EntityIdSchema.nullable().default(null),
  quantity: z.int().min(1).max(9999).default(1),
  weight: z.number().nonnegative().optional(),
  size: ItemSizeSchema.optional(),
  container: ContainerSchema.optional(),
  wearable: z
    .strictObject({
      slots: z.array(z.string().min(1)).min(1),
      covers: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  bonuses: z.array(ItemBonusSchema).default([]),
});

export const AuthoredEntitySchema = z.discriminatedUnion('kind', [
  AuthoredCharacterSchema,
  AuthoredPlaceSchema,
  AuthoredFactionSchema,
  AuthoredItemSchema,
]);
export type AuthoredEntity = z.infer<typeof AuthoredEntitySchema>;
