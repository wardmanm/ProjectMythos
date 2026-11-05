// Pass 1 of SCH-100: every file on its own. JSON and the strict schema (SCH-001, SCH-002),
// IDs that match their file names (SCH-020) and are unique in their source (SCH-011),
// entities in the folder of their kind (SCH-022), and canon beside its entity (SCH-021).
import {
  AuthoredEntitySchema,
  CalendarDefinitionSchema,
  type HistoryEntry,
  HistoryFileSchema,
  type PackManifest,
  PackManifestSchema,
  RelationshipsFileSchema,
  RulesetSchema,
  type Scenario,
  ScenarioSchema,
  type Setting,
  SettingSchema,
  SlotSchemaDefinitionSchema,
  ThemeSchema,
  ToneProfileSchema,
} from '@mythos/contracts/content';
import type { z } from 'zod';
import { nestedUnknownKeys, parseFile } from './parse';
import type {
  DefinitionEntry,
  DefinitionSet,
  EntityFile,
  PackIssue,
  Parsed,
  SeedRelationship,
  SourceFiles,
  SourceName,
} from './types';

/** A source's name, and the folder its files are reported under ('' for a pack). */
export type SourceLabel = { name: SourceName; prefix: string };

/** The folder of each definition kind, in packs and libraries alike (SCH-012). */
export const DEFINITION_FOLDERS = {
  calendars: 'calendars',
  slotSchemas: 'slot-schemas',
  toneProfiles: 'tone-profiles',
  rulesets: 'rulesets',
  themes: 'themes',
} as const;

/** The kinds each entity folder holds (SCH-022). */
const ENTITY_FOLDERS = {
  characters: ['pc', 'npc'],
  places: ['place'],
  factions: ['faction'],
  items: ['item'],
} as const;

/** An entity kind as a message reads it: "a place", "an npc". */
export function withArticle(kind: string): string {
  return kind === 'npc' || kind === 'item' ? `an ${kind}` : `a ${kind}`;
}

/** A library file is reported under its library's folder, never as an absolute path (owner decision). */
export function reportedFile(label: SourceLabel, relative: string): string {
  return label.prefix === '' ? relative : `${label.prefix}/${relative}`;
}

/** The `.json` files directly inside `folder`, in file order. */
function jsonFilesIn(source: SourceFiles, folder: string): [string, string][] {
  const prefix = `${folder}/`;
  return [...source.files].filter(
    ([relative]) =>
      relative.startsWith(prefix) &&
      relative.endsWith('.json') &&
      !relative.slice(prefix.length).includes('/'),
  );
}

function baseName(relative: string): string {
  return relative.slice(relative.lastIndexOf('/') + 1).replace(/\.(json|md)$/, '');
}

// Implements SCH-020.
function idMismatch(file: string, id: string, expected: string, what: string): PackIssue[] {
  if (id === expected) return [];
  return [{ file, path: 'id', message: `"${id}" does not match the ${what} "${expected}"` }];
}

// Implements SCH-011.
function duplicateId(file: string, id: string, firstFile: string): PackIssue {
  return { file, path: 'id', message: `"${id}" is already the id of ${firstFile}` };
}

type MutableEntry<T> = DefinitionEntry<T> & { files: string[] };

/** One folder of definitions, by ID; a second file with an ID already seen is an issue. */
function parseFolder<T extends { id: string }>(
  source: SourceFiles,
  folder: string,
  schema: z.ZodType<T>,
  label: SourceLabel,
): { entries: Map<string, DefinitionEntry<T>>; issues: PackIssue[] } {
  const entries = new Map<string, MutableEntry<T>>();
  const issues: PackIssue[] = [];
  for (const [relative, text] of jsonFilesIn(source, folder)) {
    const file = reportedFile(label, relative);
    const parsed = parseFile(file, text, schema);
    issues.push(...parsed.issues);
    const name = baseName(relative);
    if (parsed.value !== null) issues.push(...idMismatch(file, parsed.value.id, name, 'file name'));
    const id = parsed.value?.id ?? name;
    const first = entries.get(id);
    if (first === undefined) {
      const definition = parsed.value;
      entries.set(id, {
        id,
        source: label.name,
        file,
        files: [file],
        definition,
        usable: definition !== null,
      });
    } else {
      issues.push(duplicateId(file, id, first.file));
      first.files.push(file);
    }
  }
  return { entries, issues };
}

/** Every definition in a pack or library, by kind and ID, with pass-1 issues. */
export function parseDefinitions(
  source: SourceFiles,
  label: SourceLabel,
): { set: DefinitionSet; issues: PackIssue[] } {
  const folders = DEFINITION_FOLDERS;
  const calendars = parseFolder(source, folders.calendars, CalendarDefinitionSchema, label);
  const slotSchemas = parseFolder(source, folders.slotSchemas, SlotSchemaDefinitionSchema, label);
  const toneProfiles = parseFolder(source, folders.toneProfiles, ToneProfileSchema, label);
  const rulesets = parseFolder(source, folders.rulesets, RulesetSchema, label);
  const themes = parseFolder(source, folders.themes, ThemeSchema, label);
  return {
    set: {
      calendars: calendars.entries,
      slotSchemas: slotSchemas.entries,
      toneProfiles: toneProfiles.entries,
      rulesets: rulesets.entries,
      themes: themes.entries,
    },
    issues: [
      ...calendars.issues,
      ...slotSchemas.issues,
      ...toneProfiles.issues,
      ...rulesets.issues,
      ...themes.issues,
    ],
  };
}

/** A required file at the pack root, or an issue saying it is missing. */
function parseRequired<T>(
  pack: SourceFiles,
  file: string,
  schema: z.ZodType<T>,
): { value: T | null; issues: PackIssue[] } {
  const text = pack.files.get(file);
  if (text === undefined) {
    return { value: null, issues: [{ file, path: '', message: 'missing: every pack has one' }] };
  }
  return parseFile(file, text, schema);
}

function parseOptional<T>(
  pack: SourceFiles,
  file: string,
  schema: z.ZodType<T>,
): { value: T | null; issues: PackIssue[] } {
  const text = pack.files.get(file);
  return text === undefined ? { value: null, issues: [] } : parseFile(file, text, schema);
}

// Implements SCH-021: more than one public section would make JRN-031 ambiguous.
function canonIssues(file: string, canon: string): PackIssue[] {
  const headings = canon.split('\n').filter((line) => /^##\s+common knowledge\s*$/i.test(line));
  if (headings.length <= 1) return [];
  return [
    {
      file,
      path: '',
      message: `has ${String(headings.length)} "## Common knowledge" sections; keep one`,
    },
  ];
}

/** Every entity file, by ID, with its canon (SCH-021) and the pass-1 issues. */
function parseEntities(pack: SourceFiles): {
  entities: Map<string, EntityFile>;
  issues: PackIssue[];
} {
  const entities = new Map<string, EntityFile>();
  const issues: PackIssue[] = [];
  for (const [folder, kinds] of Object.entries(ENTITY_FOLDERS)) {
    for (const [file, text] of jsonFilesIn(pack, `entities/${folder}`)) {
      const parsed = parseFile(file, text, AuthoredEntitySchema, nestedUnknownKeys);
      issues.push(...parsed.issues);
      const entity = parsed.value;
      if (entity === null) continue;
      issues.push(...idMismatch(file, entity.id, baseName(file), 'file name'));
      // Implements SCH-022.
      if (!(kinds as readonly string[]).includes(entity.kind)) {
        issues.push({
          file,
          path: 'kind',
          message: `${withArticle(entity.kind)} does not belong in entities/${folder}/`,
        });
      }
      const first = entities.get(entity.id);
      if (first !== undefined) {
        issues.push(duplicateId(file, entity.id, first.file));
        continue;
      }
      const canonFile = file.replace(/\.json$/, '.md');
      const canon = pack.files.get(canonFile) ?? '';
      issues.push(...canonIssues(canonFile, canon));
      entities.set(entity.id, { file, entity, canon });
    }
  }
  return { entities, issues };
}

/** Everything in a pack that parsed, and every pass-1 issue. */
export type PackFiles = {
  manifest: PackManifest | null;
  setting: Setting | null;
  definitions: DefinitionSet;
  scenarios: Map<string, Parsed<Scenario>>;
  entities: Map<string, EntityFile>;
  history: Parsed<readonly HistoryEntry[]> | null;
  relationships: Parsed<readonly SeedRelationship[]> | null;
  issues: PackIssue[];
};

/** Pass 1 over a pack folder named `packId`. Implements SCH-001, SCH-002, SCH-011, SCH-020 to SCH-022. */
export function parsePackFiles(pack: SourceFiles, packId: string): PackFiles {
  const label: SourceLabel = { name: 'pack', prefix: '' };
  const manifest = parseRequired(pack, 'pack.json', PackManifestSchema);
  const manifestId = manifest.value?.id;
  const setting = parseRequired(pack, 'setting.json', SettingSchema);
  const definitions = parseDefinitions(pack, label);
  const scenarioFiles = parseFolder(pack, 'scenarios', ScenarioSchema, label);
  const scenarios = new Map<string, Parsed<Scenario>>();
  for (const [id, entry] of scenarioFiles.entries) {
    if (entry.definition !== null) scenarios.set(id, { file: entry.file, value: entry.definition });
  }
  const entities = parseEntities(pack);
  const history = parseOptional(pack, 'history.json', HistoryFileSchema);
  const relationships = parseOptional(pack, 'relationships.json', RelationshipsFileSchema);
  return {
    manifest: manifest.value,
    setting: setting.value,
    definitions: definitions.set,
    scenarios,
    entities: entities.entities,
    history: history.value === null ? null : { file: 'history.json', value: history.value.entries },
    relationships:
      relationships.value === null
        ? null
        : { file: 'relationships.json', value: relationships.value.relationships },
    issues: [
      ...manifest.issues,
      ...(manifestId === undefined
        ? []
        : idMismatch('pack.json', manifestId, packId, "pack's folder name")),
      ...setting.issues,
      ...definitions.issues,
      ...scenarioFiles.issues,
      ...entities.issues,
      ...history.issues,
      ...relationships.issues,
    ],
  };
}
