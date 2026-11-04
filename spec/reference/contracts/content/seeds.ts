import { z } from 'zod';
import { EntityIdSchema } from '../primitives';
import { KnowledgeViaSchema, RelationshipValueSchema } from '../memory';
import { ContentSchemaVersionSchema, SlugSchema } from './common';
import { CalendarDateSchema } from './calendar';

/**
 * Pre-campaign history. Each entry becomes an observation at campaign creation, so
 * knowledge boundaries hold from the first turn: an NPC's secret is an entry only
 * that NPC knows.
 */
export const HistoryEntrySchema = z.strictObject({
  ref: SlugSchema, // local reference, unique within the pack's history file
  when: CalendarDateSchema.optional(), // omitted = undated background, stored at game time 0
  placeId: EntityIdSchema.nullable().default(null),
  kind: z.enum(['event', 'speech', 'claim']),
  text: z.string().min(1).max(1000),
  actorIds: z.array(EntityIdSchema),
  witnessIds: z.array(EntityIdSchema),
  importance: z.int().min(1).max(10),
  tags: z.array(z.string().max(40)).default([]),
  claim: z
    .strictObject({
      sourceId: EntityIdSchema,
      audienceIds: z.array(EntityIdSchema).min(1),
      content: z.string().min(1).max(1000),
      aboutRef: SlugSchema.nullable(), // another entry's ref
      truthful: z.enum(['true', 'false', 'partly', 'unknown']),
    })
    .optional(),
  /** Additional knowers beyond witnesses (and claim audiences), e.g. common knowledge. */
  alsoKnownBy: z
    .array(z.strictObject({ entityId: EntityIdSchema, via: KnowledgeViaSchema }))
    .default([]),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export const HistoryFileSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  entries: z.array(HistoryEntrySchema),
});

export const SeedRelationshipSchema = z.strictObject({
  fromId: EntityIdSchema,
  toId: EntityIdSchema,
  dimensions: z.record(z.string(), RelationshipValueSchema),
  summary: z.string().max(600),
});

export const RelationshipsFileSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  relationships: z.array(SeedRelationshipSchema),
});
