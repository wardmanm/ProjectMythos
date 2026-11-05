import { z } from 'zod';

/** Runtime-generated record ID (turns, commits, observations, statuses, …). */
export const IdSchema = z.uuid();
export type Id = z.infer<typeof IdSchema>;

/** Entity kinds. The prefix of every EntityId. */
export const EntityKindSchema = z.enum(['pc', 'npc', 'place', 'faction', 'item']);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/**
 * Human-readable entity ID: `<kind>.<slug>`, e.g. `npc.varek`, `place.old-mill`.
 * Content-authored entities use authored slugs; runtime-created entities get a
 * slug plus a 4-char suffix, e.g. `npc.bartender-7f3a`. Models read and write these.
 */
export const EntityIdSchema = z
  .string()
  .regex(/^(pc|npc|place|faction|item)\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
export type EntityId = z.infer<typeof EntityIdSchema>;

/** Integer minutes since the campaign epoch. The only internal time value. */
export const GameTimeSchema = z.int().nonnegative();
export type GameTime = z.infer<typeof GameTimeSchema>;

/** Real-world timestamp, ISO 8601 UTC. Used only for records, never for game logic. */
export const WallTimeSchema = z.iso.datetime();
export type WallTime = z.infer<typeof WallTimeSchema>;

/**
 * Where the server reads wall time: `now()` is milliseconds since the Unix epoch. Injected
 * so tests can fix it (CONV-061). Not "clock": a clock is the progress tracker.
 */
export type TimeSource = { now(): number };

export const SchemaVersionSchema = z.int().positive();
