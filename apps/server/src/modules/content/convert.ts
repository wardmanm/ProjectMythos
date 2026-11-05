// Authored formats to runtime ones (SCH-005), and a pack with no issues to the LoadedPack that
// campaign creation snapshots (SCH-111). No IDs are generated and no clock is read (SCH-103).
import path from 'node:path';
import type { Character, Entity, Item } from '@mythos/contracts';
import type { AuthoredCharacter, AuthoredEntity } from '@mythos/contracts/content';
import { cmp } from '@mythos/core';
import { templatesDir, usableDefinitions } from './resolve';
import type { LoadedPack, PackContent } from './types';

type AuthoredItem = Extract<AuthoredEntity, { kind: 'item' }>;

/** The fields every entity shares; `media` only when authored (CON-044). */
function base(authored: AuthoredEntity) {
  return {
    id: authored.id,
    name: authored.name,
    aliases: authored.aliases,
    tags: authored.tags,
    ...(authored.media === undefined ? {} : { media: authored.media }),
  };
}

/**
 * A character as it starts play: alive, at its starting place, with no statuses yet. Its
 * `startingStatuses` stay authored, for setup to turn into statuses with IDs (SCH-117).
 * Implements SCH-005, SCH-081, and SCH-083.
 */
export function toRuntimeCharacter(authored: AuthoredCharacter): Character {
  return {
    ...base(authored),
    kind: authored.kind,
    ageCategory: authored.ageCategory,
    ...(authored.age === undefined ? {} : { age: authored.age }),
    stats: authored.stats,
    statuses: [],
    physicalDescription: authored.physicalDescription,
    personality: authored.personality,
    goals: authored.goals,
    keyNpc: authored.keyNpc,
    locationId: authored.startingLocationId,
    lifeState: 'alive',
    ...(authored.voice === undefined ? {} : { voiceProfile: authored.voice }),
  };
}

/** An item where it starts: `startingLocation` becomes `location`. Implements SCH-005. */
export function toRuntimeItem(authored: AuthoredItem): Item {
  return {
    ...base(authored),
    kind: 'item',
    description: authored.description,
    location: authored.startingLocation,
    ownerId: authored.ownerId,
    quantity: authored.quantity,
    ...(authored.weight === undefined ? {} : { weight: authored.weight }),
    ...(authored.size === undefined ? {} : { size: authored.size }),
    ...(authored.container === undefined ? {} : { container: authored.container }),
    ...(authored.wearable === undefined
      ? {}
      : { wearable: { slots: authored.wearable.slots, covers: authored.wearable.covers } }),
    bonuses: authored.bonuses,
  };
}

/** Any authored entity in runtime form (03-contracts §6). Implements SCH-005. */
export function toRuntimeEntity(authored: AuthoredEntity): Entity {
  switch (authored.kind) {
    case 'pc':
    case 'npc':
      return toRuntimeCharacter(authored);
    case 'place':
      return {
        ...base(authored),
        kind: 'place',
        parentPlaceId: authored.parentPlaceId,
        description: authored.description,
      };
    case 'faction':
      return {
        ...base(authored),
        kind: 'faction',
        description: authored.description,
        goals: authored.goals,
      };
    case 'item':
      return toRuntimeItem(authored);
  }
}

// validatePack found no issues, so anything missing here is a defect in the loader.
function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`a pack with no issues lacks ${what}`);
  return value;
}

/** The tone profiles and rulesets a pack offers, each with its templates folder (SCH-023). */
function offered(content: PackContent): Pick<LoadedPack, 'toneProfiles' | 'rulesets'> {
  const { definitions, sources } = content;
  return {
    toneProfiles: usableDefinitions(definitions.toneProfiles).map(({ entry, definition }) => ({
      definition,
      source: entry.source,
      templatesDir: templatesDir(entry, 'toneProfiles', sources),
    })),
    rulesets: usableDefinitions(definitions.rulesets).map(({ entry, definition }) => ({
      definition,
      source: entry.source,
      templatesDir: templatesDir(entry, 'rulesets', sources),
    })),
  };
}

/** The setting's slot schema and each offered tone profile's override (SCH-111). */
function slotSchemasFor(
  content: PackContent,
  slotSchemaId: string,
  toneProfiles: LoadedPack['toneProfiles'],
): LoadedPack['slotSchemas'] {
  const ids = [
    slotSchemaId,
    ...toneProfiles.flatMap(({ definition }) => definition.slotSchemaId ?? []),
  ];
  const slotSchemas = content.definitions.slotSchemas;
  return Object.fromEntries(ids.map((id) => [id, required(slotSchemas.get(id)?.definition, id)]));
}

/**
 * The resolved content of a pack that has no issues (SCH-102), with absolute templates
 * folders (SCH-023). Throws if the pack has a gap validation should have caught.
 */
export function toLoadedPack(content: PackContent, engineTemplates: string): LoadedPack {
  const { definitions, sources } = content;
  const setting = required(content.setting, 'setting.json');
  const { toneProfiles, rulesets } = offered(content);
  const entities = [...content.entities.values()].sort((a, b) => cmp(a.entity.id, b.entity.id));
  const characters = entities.flatMap(({ entity }) =>
    entity.kind === 'pc' || entity.kind === 'npc' ? [entity] : [],
  );
  const calendar = definitions.calendars.get(setting.calendarId)?.definition;
  return {
    manifest: required(content.manifest, 'pack.json'),
    setting,
    calendar: required(calendar, setting.calendarId),
    slotSchemas: slotSchemasFor(content, setting.slotSchemaId, toneProfiles),
    toneProfiles,
    rulesets,
    themes: usableDefinitions(definitions.themes).map(({ entry, definition }) => ({
      definition,
      source: entry.source,
    })),
    scenarios: setting.scenarioIds.map((id) => {
      const scenario = required(content.scenarios.get(id)?.value, id);
      const opening = required(sources.pack.files.get(scenario.openingFile), scenario.openingFile);
      return { scenario, opening };
    }),
    entities: entities.map(({ entity, canon }) => ({ entity: toRuntimeEntity(entity), canon })),
    startingStatuses: Object.fromEntries(
      characters.map((character) => [character.id, character.startingStatuses]),
    ),
    history: content.history?.value ?? [],
    relationships: content.relationships?.value ?? [],
    templates: {
      pack: sources.pack.templateDirs.includes('templates')
        ? path.join(sources.pack.root, 'templates')
        : null,
      engine: engineTemplates,
    },
  };
}
