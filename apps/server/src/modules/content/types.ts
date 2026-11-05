// The content module's data types: files read into memory, definitions by source, and the
// loaded pack handed to campaign creation (P1-T17) and prompt assembly (P1-T18).
import type { Entity, PackIssueSchema } from '@mythos/contracts';
import type {
  AuthoredEntity,
  AuthoredStatusSchema,
  CalendarDefinition,
  HistoryEntry,
  PackManifest,
  Ruleset,
  Scenario,
  SeedRelationshipSchema,
  Setting,
  SlotSchemaDefinition,
  Theme,
  ToneProfile,
} from '@mythos/contracts/content';
import type { z } from 'zod';

/** One problem found while loading a pack (SCH-100, SCH-101). */
export type PackIssue = z.infer<typeof PackIssueSchema>;

export type AuthoredStatus = z.infer<typeof AuthoredStatusSchema>;
export type SeedRelationship = z.infer<typeof SeedRelationshipSchema>;

/** Where a definition came from, in lookup order (SCH-010). */
export type SourceName = 'pack' | 'user' | 'built-in';

/** A pack or library folder read into memory, so validation can be pure (SCH-103). */
export type SourceFiles = {
  /** The folder that was read, as an absolute path. */
  root: string;
  /** Every `.json` and `.md` file as LF text without a BOM, by forward-slash relative path, in `cmp` order. */
  files: ReadonlyMap<string, string>;
  /** Every `templates/` folder found, as forward-slash relative paths. Their files are not read. */
  templateDirs: readonly string[];
};

/** The folders content is read from (04-content-schemas §2). */
export type ContentSources = {
  /** Folders holding one pack per subfolder. A later folder's pack replaces an earlier one with the same ID. */
  packFolders: readonly string[];
  /** The user library, `<dataDir>/library/`. Missing means empty. */
  userLibrary: string;
  /** The built-in library, the repository's `content-library/`. Missing is an install defect. */
  builtInLibrary: string;
  /** The engine's prompt templates, `content-library/templates/` (SCH-023). */
  engineTemplates: string;
};

/** The one logger method the module uses; the server's pino logger fits it (CONV-071). */
export type ContentLogger = {
  warn: (fields: Record<string, unknown>, message: string) => void;
};

/** One definition ID in one source, and what its file parsed to. */
export type DefinitionEntry<T> = {
  /** The parsed `id`, or the file name's when the file failed to parse. */
  id: string;
  source: SourceName;
  /** The file it came from, as `PackIssue.file` reports it. */
  file: string;
  /** Every file in this source with this ID: `file`, then any duplicates (SCH-011). */
  files: readonly string[];
  /** Null when the file failed to parse, which is already an issue. */
  definition: T | null;
  /** Whether a pack may offer it: it parsed and, for a library definition, has no problems. */
  usable: boolean;
};

/** Definitions by kind, each keyed by ID in the order they are offered. */
export type DefinitionSet = {
  calendars: ReadonlyMap<string, DefinitionEntry<CalendarDefinition>>;
  slotSchemas: ReadonlyMap<string, DefinitionEntry<SlotSchemaDefinition>>;
  toneProfiles: ReadonlyMap<string, DefinitionEntry<ToneProfile>>;
  rulesets: ReadonlyMap<string, DefinitionEntry<Ruleset>>;
  themes: ReadonlyMap<string, DefinitionEntry<Theme>>;
};

/** A definition in one source that replaces another source's definition with the same ID (SCH-010). */
export type Shadowing = { id: string; file: string; shadows: string };

/** Issues from the three passes of SCH-100, kept apart so they can be reported in pass order. */
export type PassIssues = { files: PackIssue[]; references: PackIssue[]; invariants: PackIssue[] };

/** A parsed file and where it came from, for reporting. */
export type Parsed<T> = { file: string; value: T };

/** An authored entity with its canon Markdown (SCH-021). */
export type EntityFile = { file: string; entity: AuthoredEntity; canon: string };

/** Everything in a pack that parsed, with the definitions it can use (SCH-010). */
export type PackContent = {
  /** The pack's folder name, which is its ID. */
  packId: string;
  manifest: PackManifest | null;
  setting: Setting | null;
  /** The pack's definitions, then the libraries' that it does not shadow. */
  definitions: DefinitionSet;
  scenarios: ReadonlyMap<string, Parsed<Scenario>>;
  entities: ReadonlyMap<string, EntityFile>;
  history: Parsed<readonly HistoryEntry[]> | null;
  relationships: Parsed<readonly SeedRelationship[]> | null;
  /** The files each source was read from, for openings and templates folders. */
  sources: Readonly<Record<SourceName, SourceFiles>>;
};

/** A definition a pack can use, with its source and its own templates folder (SCH-023). */
export type OfferedDefinition<T> = {
  definition: T;
  source: SourceName;
  /** Absolute path of `<folder>/<id>/templates/` beside its file, or null when there is none. */
  templatesDir: string | null;
};

/** A pack that loaded with no issues, in the form campaign creation uses (SCH-005, SCH-111). */
export type LoadedPack = {
  manifest: PackManifest;
  setting: Setting;
  calendar: CalendarDefinition;
  /** The setting's slot schema and every offered tone profile's override, by ID. */
  slotSchemas: Readonly<Record<string, SlotSchemaDefinition>>;
  toneProfiles: readonly OfferedDefinition<ToneProfile>[];
  rulesets: readonly OfferedDefinition<Ruleset>[];
  themes: readonly { definition: Theme; source: SourceName }[];
  /** In `setting.scenarioIds` order, each with its opening Markdown (SCH-003, SCH-073). */
  scenarios: readonly { scenario: Scenario; opening: string }[];
  /** Runtime entities sorted by ID with `cmp`, each with its canon Markdown (`''` when none). */
  entities: readonly { entity: Entity; canon: string }[];
  /** Each character's starting statuses in authored form; setup turns them into statuses (SCH-117). */
  startingStatuses: Readonly<Record<string, readonly AuthoredStatus[]>>;
  /** In file order. */
  history: readonly HistoryEntry[];
  /** In file order. */
  relationships: readonly SeedRelationship[];
  /** Absolute paths: the pack's `templates/` (null when it has none) and the engine's (SCH-023). */
  templates: { pack: string | null; engine: string };
};
