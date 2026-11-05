// Definition lookup order (SCH-010): the pack, then the user library, then the built-in
// library. Each source is indexed on its own first (SCH-011, in validate-files.ts), then
// merged here, so a shadowed definition is known and can be logged.
import path from 'node:path';
import type {
  CalendarDefinition,
  Ruleset,
  Setting,
  SlotSchemaDefinition,
} from '@mythos/contracts/content';
import { DEFINITION_FOLDERS } from './validate-files';
import type { DefinitionEntry, DefinitionSet, Shadowing, SourceFiles, SourceName } from './types';

/** The ruleset a pack's characters are authored against (SCH-114). */
export function defaultRulesetId(setting: Setting | null): string {
  return setting?.defaults.rulesetId ?? 'ruleset.standard';
}

/** What a pack's invariants are checked against; null when it is missing or failed to parse. */
export type PackDefaults = {
  calendar: CalendarDefinition | null;
  /** The setting's slot schema. */
  slots: SlotSchemaDefinition | null;
  /** The setting's default ruleset (SCH-114). */
  ruleset: Ruleset | null;
};

/** The setting's calendar, slot schema, and default ruleset, through the lookup order. */
export function packDefaults(setting: Setting | null, definitions: DefinitionSet): PackDefaults {
  if (setting === null) return { calendar: null, slots: null, ruleset: null };
  return {
    calendar: definitions.calendars.get(setting.calendarId)?.definition ?? null,
    slots: definitions.slotSchemas.get(setting.slotSchemaId)?.definition ?? null,
    ruleset: definitions.rulesets.get(defaultRulesetId(setting))?.definition ?? null,
  };
}

function mergeKind<T>(
  first: ReadonlyMap<string, DefinitionEntry<T>>,
  then: ReadonlyMap<string, DefinitionEntry<T>>,
  shadowings: Shadowing[],
): Map<string, DefinitionEntry<T>> {
  const merged = new Map(first);
  for (const [id, entry] of then) {
    const winner = merged.get(id);
    if (winner === undefined) merged.set(id, entry);
    else shadowings.push({ id, file: winner.file, shadows: entry.file });
  }
  return merged;
}

/**
 * `first`'s definitions, then `then`'s that `first` does not shadow, keeping that order for
 * what a pack offers. Every shadowing is listed for the caller to log. Implements SCH-010.
 */
export function mergeDefinitions(
  first: DefinitionSet,
  then: DefinitionSet,
): { set: DefinitionSet; shadowings: Shadowing[] } {
  const shadowings: Shadowing[] = [];
  const set: DefinitionSet = {
    calendars: mergeKind(first.calendars, then.calendars, shadowings),
    slotSchemas: mergeKind(first.slotSchemas, then.slotSchemas, shadowings),
    toneProfiles: mergeKind(first.toneProfiles, then.toneProfiles, shadowings),
    rulesets: mergeKind(first.rulesets, then.rulesets, shadowings),
    themes: mergeKind(first.themes, then.themes, shadowings),
  };
  return { set, shadowings };
}

/** The definitions a pack may offer, in lookup order: parsed, and without library problems. */
export function usableDefinitions<T>(entries: ReadonlyMap<string, DefinitionEntry<T>>): {
  entry: DefinitionEntry<T>;
  definition: T;
}[] {
  return [...entries.values()].flatMap((entry) =>
    entry.usable && entry.definition !== null ? [{ entry, definition: entry.definition }] : [],
  );
}

/**
 * The absolute path of a tone profile's or ruleset's own templates folder, beside its file
 * (`tone-profiles/<id>/templates/`), or null when it has none. Implements SCH-023.
 */
export function templatesDir(
  entry: DefinitionEntry<unknown>,
  kind: 'toneProfiles' | 'rulesets',
  sources: Readonly<Record<SourceName, SourceFiles>>,
): string | null {
  const source = sources[entry.source];
  const relative = `${DEFINITION_FOLDERS[kind]}/${entry.id}/templates`;
  return source.templateDirs.includes(relative)
    ? path.join(source.root, ...relative.split('/'))
    : null;
}
