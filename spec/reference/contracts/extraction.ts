import { z } from 'zod';
import { EntityIdSchema } from './primitives';
import { AgeCategorySchema, ContainerSchema, ItemSizeSchema } from './entities';
import { ClockIdSchema, HarmLevelSchema, StatIdSchema, StatusTagSchema } from './rules';

/*
 * Extraction output (08-memory §4). Model-facing (CON-003, CON-004): the model refers to
 * existing entities by EntityId, to entities it introduces by `new.<slug>`, to
 * observations it creates by `o<n>`, and to existing observations by the prompt-local
 * handles `#<n>` it was shown. The engine maps all of these to real IDs.
 */

/** An entity introduced in this output, e.g. `new.kess`. */
export const NewEntityRefSchema = z.string().regex(/^new\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** An existing entity or one introduced in this output. */
export const EntityRefSchema = z.union([EntityIdSchema, NewEntityRefSchema]);
/** An observation created in this output, e.g. `o1`. */
export const ObservationRefSchema = z.string().regex(/^o\d{1,3}$/);
/** An existing observation, by the handle shown in the prompt, e.g. `#12`. */
export const ObservationHandleSchema = z.string().regex(/^#\d{1,4}$/);

/** Limits that specialize the schema to one campaign (CON-035, MEM-041). */
export type ExtractionLimits = {
  statIds: readonly [string, ...string[]] | null;
  rating: { min: number; max: number };
  tagIds: readonly [string, ...string[]] | null;
  maxHarmLevel: number;
  dimensionIds: readonly [string, ...string[]] | null;
  maxRelationshipChange: number;
  narrativeStatuses: boolean; // ruleset ownership.statuses === 'narrative'
  narrativeClocks: boolean; // ruleset ownership.clocks === 'narrative'
};

export const BROAD_EXTRACTION_LIMITS: ExtractionLimits = {
  statIds: null,
  rating: { min: -5, max: 20 },
  tagIds: null,
  maxHarmLevel: 9,
  dimensionIds: null,
  maxRelationshipChange: 100,
  narrativeStatuses: true,
  narrativeClocks: true,
};

export function makeExtractionSchemas(limits: ExtractionLimits) {
  const tag: z.ZodType<string> = limits.tagIds ? z.enum(limits.tagIds) : StatusTagSchema;
  const rating = z.int().min(limits.rating.min).max(limits.rating.max);
  const delta = z.int().min(-limits.maxRelationshipChange).max(limits.maxRelationshipChange);
  const statHints: z.ZodType<Record<string, number>> = limits.statIds
    ? (z.strictObject(
        Object.fromEntries(limits.statIds.map((id) => [id, rating.optional()])),
      ) as z.ZodType<Record<string, number>>)
    : z.record(StatIdSchema, rating);
  const deltas: z.ZodType<Record<string, number>> = limits.dimensionIds
    ? (z.strictObject(
        Object.fromEntries(limits.dimensionIds.map((id) => [id, delta.optional()])),
      ) as z.ZodType<Record<string, number>>)
    : z.record(z.string(), delta);
  // Strict: for stat hints and deltas the key is the data, so an unknown key must fail (MEM-042).
  const allowIf = <T extends z.ZodType>(item: T, allowed: boolean, max: number) =>
    z.array(item).max(allowed ? max : 0);

  /** Something that happened, as its witnesses could perceive it (MEM §3). */
  const observation = z.object({
    ref: ObservationRefSchema,
    kind: z.enum(['event', 'speech', 'claim']),
    text: z.string().min(1).max(600), // third person, past tense, perceivable facts only
    actorIds: z.array(EntityRefSchema).max(8),
    witnessIds: z.array(EntityRefSchema).min(1).max(12),
    mentionedIds: z.array(EntityRefSchema).max(8), // referred to, not present or acting
    placeId: EntityRefSchema.nullable(), // null = the scene's place
    importance: z.int().min(1).max(10),
    tags: z.array(z.string().min(1).max(40)).max(6),
    claim: z
      .object({
        sourceId: EntityRefSchema,
        audienceIds: z.array(EntityRefSchema).min(1).max(12),
        content: z.string().min(1).max(600), // what was asserted, as stated
        about: z.union([ObservationRefSchema, ObservationHandleSchema]).nullable(),
        truthful: z.enum(['true', 'false', 'partly', 'unknown']),
      })
      .optional(),
  });

  const newCharacter = z.object({
    kind: z.literal('npc'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120), // a descriptor until a name is learned, e.g. "the bartender"
    aliases: z.array(z.string().max(120)).max(5),
    ageCategory: AgeCategorySchema,
    physicalDescription: z.string().max(600),
    personality: z.string().min(1).max(400),
    stats: statHints, // stats the fiction shows; others take the ruleset default
    locationId: EntityRefSchema.nullable(),
  });
  const newPlace = z.object({
    kind: z.literal('place'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120),
    aliases: z.array(z.string().max(120)).max(5),
    description: z.string().max(1000),
    parentPlaceId: EntityRefSchema.nullable(),
  });
  const itemLocation = z.discriminatedUnion('type', [
    z.object({ type: z.literal('held'), characterId: EntityRefSchema }),
    z.object({ type: z.literal('carried'), characterId: EntityRefSchema }),
    z.object({
      type: z.literal('worn'),
      characterId: EntityRefSchema,
      slot: z.string().min(1),
      layer: z.int().nonnegative(),
    }),
    z.object({ type: z.literal('contained'), containerId: EntityRefSchema }),
    z.object({ type: z.literal('placed'), placeId: EntityRefSchema }),
    z.object({ type: z.literal('gone') }),
  ]);
  const newItem = z.object({
    kind: z.literal('item'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120), // lowercase, no article, singular: "brass key" (GEAR-065)
    aliases: z.array(z.string().max(120)).max(5),
    description: z.string().max(600),
    location: itemLocation,
    ownerId: EntityRefSchema.nullable(),
    quantity: z.int().min(1).max(999),
    size: ItemSizeSchema.nullable(), // needed when the ruleset carries in containers
    weight: z.number().nonnegative().nullable(), // needed when the ruleset uses encumbrance
    container: ContainerSchema.nullable(), // a bag, a box, a coat with pockets
  });
  const newFaction = z.object({
    kind: z.literal('faction'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120),
    aliases: z.array(z.string().max(120)).max(5),
    description: z.string().max(1000),
  });

  const statusChange = z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add'),
      characterId: EntityRefSchema,
      name: z.string().min(1).max(80),
      kind: z.enum(['harm', 'condition']),
      level: HarmLevelSchema.max(limits.maxHarmLevel).nullable(), // null for conditions
      tags: z.array(tag).max(3),
    }),
    z.object({
      op: z.literal('remove'),
      characterId: EntityRefSchema,
      statusName: z.string().min(1).max(80),
    }),
  ]);
  const clockChange = z.object({ clockId: ClockIdSchema, ticks: z.int().min(-6).max(6) });

  const extraction = z.object({
    observations: z.array(observation).max(20),
    newEntities: z
      .array(z.discriminatedUnion('kind', [newCharacter, newPlace, newItem, newFaction]))
      .max(8),
    entityUpdates: z
      .array(
        z.object({
          entityId: EntityRefSchema,
          name: z.string().min(1).max(120).nullable(), // e.g. a real name learned
          addAliases: z.array(z.string().max(120)).max(5),
          physicalDescription: z.string().max(1000).nullable(),
          description: z.string().max(2000).nullable(),
        }),
      )
      .max(8),
    moves: z
      .array(z.object({ characterId: EntityRefSchema, toPlaceId: EntityRefSchema.nullable() }))
      .max(12),
    itemMoves: z
      .array(
        z.object({
          itemId: EntityRefSchema,
          to: itemLocation,
          ownerId: EntityRefSchema.nullable().optional(), // only when ownership changed: a gift, a sale
        }),
      )
      .max(12),
    quantityChanges: z
      .array(z.object({ itemId: EntityRefSchema, delta: z.int().min(-999).max(999) }))
      .max(8),
    namesLearned: z
      .array(
        z.object({
          knowerId: EntityRefSchema, // usually the PC
          entityId: EntityRefSchema,
          name: z.string().min(1).max(120), // as the knower now calls them
        }),
      )
      .max(8),
    relationshipChanges: z
      .array(
        z.object({
          fromId: EntityRefSchema, // the PC only when the ruleset tracks PC relationships (MEM-064)
          toId: EntityRefSchema,
          deltas,
          reason: z.string().min(1).max(300),
          keyObservationRef: z.union([ObservationRefSchema, ObservationHandleSchema]).nullable(), // a defining moment
          summary: z.string().max(600).nullable(), // replaces the summary when it changed
        }),
      )
      .max(12),
    wikiPatches: z
      .array(
        z.discriminatedUnion('op', [
          z.object({
            op: z.literal('upsert'),
            entityId: EntityRefSchema,
            heading: z.string().min(1).max(80),
            body: z.string().min(1).max(1500),
            sourceRefs: z.array(z.union([ObservationRefSchema, ObservationHandleSchema])).max(10),
          }),
          z.object({
            op: z.literal('remove'),
            entityId: EntityRefSchema,
            heading: z.string().min(1).max(80),
          }),
        ]),
      )
      .max(8),
    statusChanges: allowIf(statusChange, limits.narrativeStatuses, 8),
    clockChanges: allowIf(clockChange, limits.narrativeClocks, 6),
  });

  return { observation, newCharacter, newPlace, newItem, newFaction, extraction };
}

const broad = makeExtractionSchemas(BROAD_EXTRACTION_LIMITS);
export const ExtractionSchema = broad.extraction;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedObservation = z.infer<typeof broad.observation>;
