import { z } from 'zod';
import { EntityIdSchema, EntityKindSchema, GameTimeSchema, IdSchema } from './primitives';
import { BeliefSchema, KnowledgeViaSchema, NoteSchema } from './memory';

/*
 * The player's journal (10-journal). Everything here is derived from one knower's
 * knowledge: the PC normally, any character in GM mode's "view as".
 */

export const JournalEntrySummarySchema = z.object({
  entityId: EntityIdSchema,
  kind: EntityKindSchema,
  displayName: z.string(), // as the knower knows them (JRN-020)
  lastEncountered: GameTimeSchema.nullable(),
  present: z.boolean(), // in the knower's current scene
  noteCount: z.int().nonnegative(),
  beliefCount: z.int().nonnegative(),
});
export type JournalEntrySummary = z.infer<typeof JournalEntrySummarySchema>;

/** One known observation as the journal shows it. */
export const JournalItemSchema = z.object({
  observationId: IdSchema,
  gameTime: GameTimeSchema,
  gameTimeLabel: z.string(),
  text: z.string(), // claims rendered as "<source> told you that <content>" (MEM-076)
  via: KnowledgeViaSchema,
  placeName: z.string().nullable(),
  importance: z.int().min(1).max(10),
  correctable: z.boolean(), // the player may amend it outside GM mode (JRN-041)
});
export type JournalItem = z.infer<typeof JournalItemSchema>;

export const JournalPageSchema = z.object({
  entityId: EntityIdSchema,
  kind: EntityKindSchema,
  displayName: z.string(),
  otherNames: z.array(z.string()), // earlier names and descriptors the knower used
  commonKnowledge: z.string().nullable(), // from canon (JRN-031)
  sections: z.array(z.object({ heading: z.string(), body: z.string() })), // wiki sections the knower may see (JRN-030)
  relationship: z // the knower's own feelings toward this entity; editable
    .object({ dimensions: z.record(z.string(), z.int()), summary: z.string() })
    .nullable(),
  items: z.array(JournalItemSchema), // newest first, paged
  notes: z.array(NoteSchema),
  beliefs: z.array(BeliefSchema),
});
export type JournalPage = z.infer<typeof JournalPageSchema>;

export const ChronicleQuerySchema = z.object({
  knowerId: EntityIdSchema.optional(), // GM mode only; defaults to the PC
  entityId: EntityIdSchema.optional(),
  search: z.string().max(200).optional(),
  beforeGameTime: GameTimeSchema.optional(),
  limit: z.int().min(1).max(200).default(50),
});
