import { z } from 'zod';

/** Lowercase slug: `a-z0-9` words joined by single hyphens. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** ID for a content definition: `<prefix>.<slug>`, e.g. `tone.grimdark`, `calendar.gregorian`. */
export const definitionId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}\\.[a-z0-9]+(?:-[a-z0-9]+)*$`));

export const PackIdSchema = SlugSchema;
export const CalendarIdSchema = definitionId('calendar');
export const SlotSchemaIdSchema = definitionId('slots');
export const ToneProfileIdSchema = definitionId('tone');
export const RulesetIdSchema = definitionId('ruleset');
export const ScenarioIdSchema = definitionId('scenario');
export const SettingIdSchema = definitionId('setting');
export const ThemeIdSchema = definitionId('theme');

/** Every authored JSON file declares its format version (ARCH-051). */
export const ContentSchemaVersionSchema = z.literal(1);
