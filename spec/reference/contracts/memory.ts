import { z } from 'zod';
import { EntityIdSchema, GameTimeSchema, IdSchema } from './primitives';

/**
 * An observation: something that happened, from which knowledge derives.
 * Stored at truth level. Who knows it is recorded separately as knowledge grants.
 */
export const ObservationSchema = z.object({
  id: IdSchema,
  turnId: IdSchema,
  gameTime: GameTimeSchema,
  placeId: EntityIdSchema.nullable(),
  kind: z.enum(['event', 'speech', 'claim', 'summary']),
  /** Concise third-person statement of what happened. */
  text: z.string().min(1).max(1000),
  actorIds: z.array(EntityIdSchema), // who did it
  witnessIds: z.array(EntityIdSchema), // who directly perceived it
  mentionedIds: z.array(EntityIdSchema), // referred to but not present or acting, e.g. "a man named Tomas"
  importance: z.int().min(1).max(10),
  tags: z.array(z.string().max(40)),
  /** Present when kind is 'claim': someone told someone something. */
  claim: z
    .object({
      sourceId: EntityIdSchema,
      audienceIds: z.array(EntityIdSchema).min(1),
      content: z.string().min(1).max(1000), // what was claimed, as stated
      aboutObservationId: IdSchema.nullable(), // the truth it concerns, if any
      truthful: z.enum(['true', 'false', 'partly', 'unknown']), // truth-level judgment
    })
    .optional(),
  /** Present when kind is 'summary': the observations it consolidates. */
  summarizesIds: z.array(IdSchema).optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

/** How an entity came to know an observation. */
export const KnowledgeViaSchema = z.enum(['witnessed', 'told', 'rumor', 'inferred']);

/**
 * A record that an entity knows an observation. Witnesses receive grants automatically.
 * `viaObservationId` points to the claim observation through which it was learned.
 */
export const KnowledgeGrantSchema = z.object({
  entityId: EntityIdSchema,
  observationId: IdSchema,
  via: KnowledgeViaSchema,
  viaObservationId: IdSchema.nullable(),
  gameTime: GameTimeSchema,
});
export type KnowledgeGrant = z.infer<typeof KnowledgeGrantSchema>;

/** Relationship dimension values. Dimension names are defined by the ruleset. */
/** Outer limits; the ruleset sets the actual range (RUL §8). */
export const RelationshipValueSchema = z.int().min(-100).max(100);

/** Directed: how `fromId` regards `toId`. */
export const RelationshipSchema = z.object({
  fromId: EntityIdSchema,
  toId: EntityIdSchema,
  dimensions: z.record(z.string(), RelationshipValueSchema), // e.g. { trust: 2, affection: -1 }
  summary: z.string().max(600),
  keyObservationIds: z.array(IdSchema).max(20),
});
export type Relationship = z.infer<typeof RelationshipSchema>;

export const WikiSectionSchema = z.object({
  heading: z.string().min(1).max(80),
  body: z.string().max(4000),
  sourceObservationIds: z.array(IdSchema),
});

/** Truth-level living page for an entity. Canon text comes from the content snapshot. */
export const EntityWikiPageSchema = z.object({
  entityId: EntityIdSchema,
  canon: z.string(), // markdown, read-only
  learned: z.array(WikiSectionSchema),
});
export type EntityWikiPage = z.infer<typeof EntityWikiPageSchema>;

/** Player-authored journal note. */
export const NoteSchema = z.object({
  id: IdSchema,
  subjectId: EntityIdSchema.nullable(), // null = general note
  text: z.string().min(1).max(4000),
});
export type Note = z.infer<typeof NoteSchema>;

/** Player-authored statement of what the PC believes. Never changes truth. */
export const BeliefSchema = z.object({
  id: IdSchema,
  subjectId: EntityIdSchema.nullable(),
  statement: z.string().min(1).max(600),
  confidence: z.enum(['suspect', 'believe', 'certain']),
});
export type Belief = z.infer<typeof BeliefSchema>;

/** Why a retrieved observation was chosen; shown in the context inspector (MEM §6). */
export const RetrievalReasonSchema = z.enum([
  'pinned-recent', // among the latest shared moments with the PC
  'pinned-key', // a relationship's defining observation
  'scored', // ranked in by score
]);

/** One observation selected for a prompt, from one character's point of view. */
export const RetrievedObservationSchema = z.object({
  observationId: IdSchema,
  knowerId: EntityIdSchema, // whose memory this is
  text: z.string(), // claims render as "<source> told <audience> that <content>"
  gameTime: GameTimeSchema,
  via: KnowledgeViaSchema,
  importance: z.int().min(1).max(10),
  reason: RetrievalReasonSchema,
  score: z.number(),
  scoreParts: z.object({
    importance: z.number(),
    recency: z.number(),
    relevance: z.number(),
    entities: z.number(),
    pc: z.number(),
  }),
});
export type RetrievedObservation = z.infer<typeof RetrievedObservationSchema>;
