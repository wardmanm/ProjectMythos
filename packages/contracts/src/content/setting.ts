import { z } from 'zod';
import {
  CalendarIdSchema,
  ContentSchemaVersionSchema,
  PackIdSchema,
  RulesetIdSchema,
  ScenarioIdSchema,
  SettingIdSchema,
  SlotSchemaIdSchema,
  ToneProfileIdSchema,
} from './common';
import { CalendarDateSchema } from './calendar';

export const PackManifestSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: PackIdSchema,
  name: z.string().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/), // semver, bumped by the author
  description: z.string().max(1000),
  author: z.string().max(80).optional(),
});
export type PackManifest = z.infer<typeof PackManifestSchema>;

export const SettingSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: SettingIdSchema,
  name: z.string().min(1).max(80),
  /** One-paragraph summary always included in the GM's stable prompt prefix. */
  summary: z.string().min(1).max(1500),
  calendarId: CalendarIdSchema,
  /** Game time 0. Must be at or before every dated history entry. */
  epoch: CalendarDateSchema,
  /** Weekday index (0-based) of the epoch date, if the calendar has weekdays. */
  epochWeekday: z.int().min(0).default(0),
  slotSchemaId: SlotSchemaIdSchema,
  worldTickMinutes: z.int().min(60).default(480), // 12-time-world §5
  /** A single time advance at least this long starts a new scene (TIME-030). */
  sceneBreakMinutes: z.int().min(30).default(240),
  defaults: z.strictObject({
    toneProfileId: ToneProfileIdSchema.optional(),
    rulesetId: RulesetIdSchema.optional(),
  }),
  scenarioIds: z.array(ScenarioIdSchema).min(1),
});
export type Setting = z.infer<typeof SettingSchema>;
