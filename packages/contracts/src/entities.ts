import { z } from 'zod';
import { EntityIdSchema } from './primitives';
import { StatBlockSchema, StatIdSchema, StatusSchema, StatusTagSchema } from './rules';

/** Reserved for phase 9 (ARCH-132). Validated, otherwise ignored until then. */
/**
 * Identity hooks for consistent images (MED §3). Portable: no machine-specific IDs.
 * Generated portraits are campaign assets, not entity fields (MED-010).
 */
export const EntityMediaSchema = z.object({
  referenceImage: z.string().min(1).max(200).optional(), // pack-relative path, e.g. "media/npc.varek.png"
  loraName: z.string().min(1).max(200).optional(), // passed to workflows that map a LoRA input
  loraStrength: z.number().min(0).max(2).optional(),
  imagePrompt: z.string().max(300).optional(), // always-included visual details, e.g. "pale scar through one eyebrow"
});

/**
 * How a character sounds (MED §5). Portable: a description, never a provider's voice ID.
 * Each machine maps characters to its own voices (MED-052).
 */
export const VoiceProfileSchema = z.object({
  description: z.string().min(1).max(200), // e.g. "low, dry, unhurried; a harbor clerk's careful diction"
  speed: z.number().min(0.5).max(2).optional(),
});

const EntityBaseSchema = z.object({
  id: EntityIdSchema,
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().max(120)),
  tags: z.array(z.string().max(40)),
  media: EntityMediaSchema.optional(),
});

/** Required on every character; enforced by the hard floor (13-content-settings). */
export const AgeCategorySchema = z.enum(['adult', 'minor']);

export const CharacterSchema = EntityBaseSchema.extend({
  kind: z.enum(['pc', 'npc']),
  ageCategory: AgeCategorySchema,
  age: z.int().nonnegative().optional(),
  stats: StatBlockSchema,
  statuses: z.array(StatusSchema),
  physicalDescription: z.string().max(1000), // excludes clothing; see appearance
  personality: z.string().max(600), // short, always in context when present (SCH-080)
  goals: z.array(z.string().min(1).max(200)).max(8), // non-empty = active NPC (SCH-081)
  keyNpc: z.boolean(), // always voiced by a separate call (CTX §6)
  locationId: EntityIdSchema.nullable(), // a place, or null if off-map
  lifeState: z.enum(['alive', 'dead']),
  voiceProfile: VoiceProfileSchema.optional(),
});
export type Character = z.infer<typeof CharacterSchema>;

export const PlaceSchema = EntityBaseSchema.extend({
  kind: z.literal('place'),
  parentPlaceId: EntityIdSchema.nullable(),
  description: z.string().max(2000),
});
export type Place = z.infer<typeof PlaceSchema>;

export const FactionSchema = EntityBaseSchema.extend({
  kind: z.literal('faction'),
  description: z.string().max(2000),
  goals: z.array(z.string().min(1).max(200)).max(8), // non-empty = active in world ticks (TIME-060)
});
export type Faction = z.infer<typeof FactionSchema>;

/** Where an item is. Exactly one location at a time. Detailed in 11-gear. */
export const ItemLocationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('worn'),
    characterId: EntityIdSchema,
    slot: z.string().min(1), // slot name from the slot schema
    layer: z.int().nonnegative(), // 0 = outermost
  }),
  z.object({ type: z.literal('held'), characterId: EntityIdSchema }),
  z.object({ type: z.literal('carried'), characterId: EntityIdSchema }), // encumbrance mode
  z.object({ type: z.literal('contained'), containerId: EntityIdSchema }),
  z.object({ type: z.literal('placed'), placeId: EntityIdSchema }),
  z.object({ type: z.literal('gone') }), // consumed or destroyed
]);
export type ItemLocation = z.infer<typeof ItemLocationSchema>;

export const ItemSizeSchema = z.enum(['tiny', 'small', 'medium', 'large', 'huge']);
export type ItemSize = z.infer<typeof ItemSizeSchema>;

/** An item that holds others: total space in size points, and the largest item that fits (GEAR §5). */
export const ContainerSchema = z.object({
  capacity: z.int().min(1).max(1000),
  maxItemSize: ItemSizeSchema,
});

export const ItemBonusSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('roll'),
    stat: StatIdSchema.optional(), // omitted = any stat when the situation applies
    situation: z.string().min(1).max(200), // e.g. "climbing"
    points: z.int().min(1).max(4), // dice in pool methods; pointValue each in sum (RUL-023)
  }),
  z.object({
    type: z.literal('harm-reduction'),
    levels: z.int().min(1).max(3),
    tags: z.array(StatusTagSchema).min(1),
    usesPerScene: z.int().positive().optional(),
  }),
  z.object({
    type: z.literal('resistance'), // added to resistance rolls against these tags (RUL-087)
    tags: z.array(StatusTagSchema).min(1),
    points: z.int().min(1).max(4),
  }),
]);

export const ItemSchema = EntityBaseSchema.extend({
  kind: z.literal('item'),
  description: z.string().max(1000),
  location: ItemLocationSchema,
  ownerId: EntityIdSchema.nullable(), // who it belongs to, which may differ from who has it
  quantity: z.int().min(1).max(9999), // a stack of identical items, e.g. 15 potions
  weight: z.number().nonnegative().optional(), // per unit; encumbrance mode
  size: ItemSizeSchema.optional(), // per unit; containers mode
  container: ContainerSchema.optional(), // present if the item holds other items
  wearable: z
    .object({
      slots: z.array(z.string().min(1)).min(1), // slots it can be worn in
      covers: z.array(z.string().min(1)), // other slots it hides while worn, e.g. a cloak over the belt
    })
    .optional(),
  bonuses: z.array(ItemBonusSchema),
});
export type Item = z.infer<typeof ItemSchema>;

export const EntitySchema = z.discriminatedUnion('kind', [
  CharacterSchema,
  PlaceSchema,
  FactionSchema,
  ItemSchema,
]);
export type Entity = z.infer<typeof EntitySchema>;
