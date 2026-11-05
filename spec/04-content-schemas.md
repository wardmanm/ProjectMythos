---
doc: 04-content-schemas
title: Mythos — Content Schemas
status: draft
schemaVersion: 1
requirementPrefix: SCH
---

# Content Schemas

> **For Claude:** the code in this document is **normative** and was typechecked with the
> contracts in `03-contracts.md`. Each code section corresponds to one file in
> `packages/contracts/src/content/`; copy it verbatim. The JSON examples in §9 are
> excerpts of the reference pack fixture, `spec/fixtures/packs/reference/`, which
> validates against these schemas.

This document defines the file formats authors write: content packs, settings,
calendars, slot schemas, tone profiles, rulesets, scenarios, entities, history, and
relationships. It defines **shape and loading rules**. The *behavior* of ruleset
fields is in `07-rules.md`, of content settings in `13-content-settings.md`, of
calendars and ticks in `12-time-world.md`, and of slots in `11-gear.md`.

## 1. Principles

- **SCH-001** Every authored JSON file is parsed with a **strict** schema: unknown keys
  are errors. A typo like `"lethalty"` fails loudly instead of being ignored.
- **SCH-002** Every authored JSON file has `schemaVersion` (ARCH-051).
- **SCH-003** JSON holds structure; Markdown holds prose. Long descriptive text (entity
  canon, scenario openings) lives in `.md` files, not in JSON strings.
- **SCH-004** Content files are never modified by the running game. Campaigns work on
  a snapshot (ARCH-045).
- **SCH-005** Authored formats are separate from runtime formats. The loader converts
  authored entities into runtime entities (`03-contracts.md` §6) at campaign creation:
  `personality` and `goals` (characters and factions) carry over, `voice` becomes
  `voiceProfile`, `startingLocationId` becomes `locationId`, and `startingLocation`
  becomes `location`. `startingStatuses` become statuses during setup (SCH-117), which
  assigns their IDs and sets `inflictedAt` and `changedAt` to the scenario's start, so
  loading itself stays deterministic (SCH-103).

## 2. Where content lives

Three sources, searched in this order when resolving a definition ID:

| Source | Location | Contains |
|---|---|---|
| **Pack** | `<dataDir>/content-packs/<packId>/`, and `content-packs/<packId>/` in the repo, which ships the reference pack. A data-directory pack replaces a repo pack with the same ID, with a warning | A setting and everything specific to it |
| **User library** | `<dataDir>/library/` | Reusable definitions the player saved (tone profiles, rulesets, calendars, slot schemas) |
| **Built-in library** | `content-library/` in the repo, shipped with the app | Defaults: `calendar.gregorian`, four rulesets (`ruleset.standard` and three examples), `slots.simple`, four starter tone profiles, six themes |

- **SCH-010** A definition ID resolves to the first match in the order above. When a
  pack definition shadows a library definition with the same ID, the loader logs a
  warning.
- **SCH-011** Two definitions with the same ID in the same source are a load error.
- **SCH-012** Library folders use the same subfolder names as packs
  (`calendars/`, `slot-schemas/`, `tone-profiles/`, `rulesets/`, `themes/`). Themes
  are specified in `14-ui.md` §3.

### 2.1 Pack layout

```
<packId>/
  pack.json                     manifest (required)
  setting.json                  the setting (required, exactly one)
  calendars/<id>.json           optional; else resolved from libraries
  slot-schemas/<id>.json        optional
  tone-profiles/<id>.json       optional
  tone-profiles/<id>/templates/ optional prompt templates for that tone profile (SCH-023)
  rulesets/<id>.json            optional
  rulesets/<id>/templates/      optional prompt templates for that ruleset
  scenarios/<id>.json           at least one, listed in setting.scenarioIds
  scenarios/*.md                opening situations
  entities/
    characters/<id>.json  + optional <id>.md canon
    places/<id>.json      + optional <id>.md
    factions/<id>.json    + optional <id>.md
    items/<id>.json       + optional <id>.md
  history.json                  optional pre-campaign history
  relationships.json            optional starting relationships
  templates/                    optional prompt template overrides (09-context)
  themes/<id>.json              optional themes (14-ui §3)
  media/                        optional reference images for consistent portraits (MED-029)
  fonts/                        optional .woff2 fonts, each with its license file (UI-034)
```

- **SCH-020** Every definition and entity file is named exactly `<id>.json`, and the
  `id` inside matches the file name.
- **SCH-021** An entity's canon Markdown is the `.md` file with the same base name. It
  becomes the `canon` field of the entity's wiki page. Missing `.md` means empty canon.
  A `## Common knowledge` section in it is lore the player may see once the PC knows
  the entity (JRN-031); the rest of canon is truth, visible only in GM mode.
- **SCH-022** Entity files sit in the folder matching their `kind`
  (`pc`/`npc` → `characters/`).
- **SCH-023** A tone profile's or ruleset's own prompt templates (CTX-004, layers 3 and
  5) sit in a folder named after its ID beside its file, `tone-profiles/<id>/templates/`
  or `rulesets/<id>/templates/`, in packs and libraries alike. A pack's own templates
  are `templates/` at its root; the engine's are `content-library/templates/`.

## 3. Shared primitives — `common.ts`

```ts
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
```

## 4. Calendars — `calendar.ts`

A calendar turns game time (integer minutes) into dates. Months, lengths, weekdays,
intercalary days (festivals outside any month), and a leap rule cover real and
common fantasy calendars.

```ts
import { z } from 'zod';
import { CalendarIdSchema, ContentSchemaVersionSchema } from './common';

export const CalendarMonthSchema = z.strictObject({
  name: z.string().min(1).max(40),
  /** 0 is allowed for an intercalary day that exists only in leap years (via leapDays). */
  days: z.int().min(0).max(400),
  /** Intercalary periods (festival days) sit between months and have no weekday if weekdaysSkipIntercalary. */
  intercalary: z.boolean().default(false),
  /** Days added to this month in leap years. */
  leapDays: z.int().min(0).max(10).default(0),
});

export const LeapRuleSchema = z.strictObject({
  every: z.int().min(2), // e.g. 4
  exceptEvery: z.int().min(2).optional(), // e.g. 100
  unlessEvery: z.int().min(2).optional(), // e.g. 400
});

export const TimeOfDaySchema = z.strictObject({
  name: z.string().min(1).max(40), // e.g. "dawn"
  startHour: z.int().min(0),
});

export const CalendarDefinitionSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: CalendarIdSchema,
  name: z.string().min(1).max(80),
  minutesPerHour: z.int().min(1).default(60),
  hoursPerDay: z.int().min(1).default(24),
  months: z.array(CalendarMonthSchema).min(1),
  weekdays: z.array(z.string().min(1).max(40)), // empty = no week cycle
  weekdaysSkipIntercalary: z.boolean().default(false),
  leapRule: LeapRuleSchema.nullable().default(null),
  eraSuffix: z.string().max(20).default(''), // e.g. "DR", "AD"
  timesOfDay: z.array(TimeOfDaySchema), // ordered by startHour
  /**
   * Display format. Tokens: {weekday} {day} {month} {monthNumber} {year} {era} {hour}
   * {minute} {timeOfDay}. {hour} and {minute} are zero-padded to two digits.
   */
  format: z.string().min(1).max(120),
  /** Format for intercalary days, which often have no weekday or day number. Defaults to `format`. */
  intercalaryFormat: z.string().min(1).max(120).optional(),
});
export type CalendarDefinition = z.infer<typeof CalendarDefinitionSchema>;

/** A point on a calendar. `month` is a 1-based index into `months` (intercalary entries included). */
export const CalendarDateSchema = z.strictObject({
  year: z.int(),
  month: z.int().min(1),
  day: z.int().min(1),
  hour: z.int().min(0).default(0),
  minute: z.int().min(0).default(0),
});
export type CalendarDate = z.infer<typeof CalendarDateSchema>;
```

**Invariants**

- **SCH-030** `timesOfDay` is ordered by `startHour`, starts at hour 0, and every
  `startHour` is less than `hoursPerDay`.
- **SCH-031** A `CalendarDate` is valid only if its month, day, hour, and minute exist
  in the calendar for that year (including leap days).
- **SCH-032** `format` and `intercalaryFormat` use only the listed tokens. All calendar
  checks, including leap-only festivals, are in `calendarIssues` (TIME-004); calendar
  semantics are defined in `12-time-world.md` §2.

## 5. Slot schemas — `slots.ts`

```ts
import { z } from 'zod';
import { ContentSchemaVersionSchema, SlugSchema, SlotSchemaIdSchema } from './common';

export const LayerDefinitionSchema = z.strictObject({
  name: z.string().min(1).max(40), // e.g. "outer", "under"
  visibility: z.enum(['visible', 'concealed']),
});

export const SlotDefinitionSchema = z.strictObject({
  id: SlugSchema, // e.g. "torso"
  name: z.string().min(1).max(40),
  /** Ordered outermost first. Layer index 0 is the outermost. */
  layers: z.array(LayerDefinitionSchema).min(1).max(5),
  itemsPerLayer: z.int().min(1).max(5).default(1),
});

export const SlotSchemaDefinitionSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: SlotSchemaIdSchema,
  name: z.string().min(1).max(80),
  slots: z.array(SlotDefinitionSchema).min(1),
  /** How many items a character can hold in hand at once. */
  heldItems: z.int().min(0).max(4).default(2),
});
export type SlotSchemaDefinition = z.infer<typeof SlotSchemaDefinitionSchema>;
```

- **SCH-040** Slot IDs are unique within a schema. Layer index 0 is outermost; an item
  in a concealed layer is concealed (glossary *Concealed*).

## 6. Tone profiles — `tone-profile.ts`

```ts
import { z } from 'zod';
import {
  ContentSchemaVersionSchema,
  SlotSchemaIdSchema,
  ThemeIdSchema,
  ToneProfileIdSchema,
} from './common';

export const IntensityLevelSchema = z.enum(['off', 'fade-to-black', 'moderate', 'explicit']);
export type IntensityLevel = z.infer<typeof IntensityLevelSchema>;

/** Behavior of each category is defined in 13-content-settings. The hard floor is not configurable. */
export const ContentSettingsSchema = z.strictObject({
  violence: IntensityLevelSchema,
  gore: IntensityLevelSchema,
  sexual: IntensityLevelSchema,
  language: IntensityLevelSchema,
  disturbing: IntensityLevelSchema,
  lines: z.array(z.string().min(1).max(200)), // never appears
  veils: z.array(z.string().min(1).max(200)), // happens off-page
});
export type ContentSettings = z.infer<typeof ContentSettingsSchema>;

export const ToneProfileSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: ToneProfileIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),
  genre: z.string().min(1).max(120), // e.g. "low fantasy mystery"
  tone: z.string().min(1).max(600), // free prose: mood, feel, touchstones
  themes: z.array(z.string().min(1).max(80)),
  narration: z.strictObject({
    perspective: z.enum(['second-person', 'third-person']),
    tense: z.enum(['present', 'past']),
    length: z.enum(['brief', 'standard', 'rich']),
    style: z.string().max(600), // prose-style guidance for the narrator
  }),
  pacing: z.enum(['slow', 'standard', 'fast']),
  content: ContentSettingsSchema,
  /** Overrides the setting's slot schema when present. */
  slotSchemaId: SlotSchemaIdSchema.optional(),
  /** The campaign's look (14-ui §3). Absent = the house theme. */
  themeId: ThemeIdSchema.optional(),
  /** Reserved for phase 9 image prompts. */
  artStyle: z.string().max(600).optional(),
  /** When the profile was built from free text, the original text is kept here. */
  sourceText: z.string().max(8000).optional(),
});
export type ToneProfile = z.infer<typeof ToneProfileSchema>;
```

- **SCH-050** A tone profile built from free text (phase 8) keeps the original text in
  `sourceText`, so it can be re-parsed or shown to the player.
- **SCH-051** `lines` and `veils` are free text; the GM prompt includes them verbatim.

## 7. Rulesets — `ruleset.ts`

```ts
import { z } from 'zod';
import { EffectLevelSchema, RollResultSchema, StatIdSchema, StatusTagSchema } from '../rules';
import { ContentSchemaVersionSchema, RulesetIdSchema, SlugSchema } from './common';

/*
 * A ruleset describes a complete game system as data (07-rules). Every field is a
 * parameter of a fixed building block in `core`; there is no scripting. Adding a new
 * building block (a new dice method, say) is a code change with an ADR.
 */

export const OwnershipSchema = z.enum(['authoritative', 'narrative']);
export const LethalitySchema = z.enum(['lethal', 'heroic', 'none']);

// --------------------------------------------------------------------- stats

export const StatDefinitionSchema = z.strictObject({
  id: StatIdSchema, // e.g. "str"
  name: z.string().min(1).max(40), // "Strength"
  abbreviation: z.string().min(1).max(6), // "STR"
  description: z.string().min(1).max(300), // what it covers; shown to the GM and player
});

// --------------------------------------------------------------------- dice

/** Read value at or above `min` gives `result`. Bands are ordered highest `min` first. */
export const ResultBandSchema = z.strictObject({ min: z.int(), result: RollResultSchema });

/** A critical from dice faces, checked on the dice that count (RUL §3.3). */
export const CriticalRuleSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('none') }),
  z.strictObject({
    type: z.literal('faces'),
    face: z.int().min(1).max(100), // e.g. 6
    count: z.int().min(1).max(10), // e.g. 2 → "two or more sixes"
  }),
]);

/** What to roll when the pool is 0 or less (pool methods only). */
export const EmptyPoolSchema = z.strictObject({
  roll: z.int().min(1).max(5), // e.g. 2
  keep: z.enum(['lowest', 'highest']), // e.g. lowest
});

const Sides = z.int().min(2).max(100);
const Bands = z.array(ResultBandSchema).min(1).max(4);

export const DiceRulesSchema = z.discriminatedUnion('method', [
  /** Roll `points` dice; read the highest die. (Blades in the Dark) */
  z.strictObject({
    method: z.literal('pool-highest'),
    sides: Sides,
    maxPool: z.int().min(1).max(30),
    emptyPool: EmptyPoolSchema,
    bands: Bands,
    critical: CriticalRuleSchema,
  }),
  /** Roll `points` dice; read how many show `successOn` or higher. (World of Darkness) */
  z.strictObject({
    method: z.literal('pool-count'),
    sides: Sides,
    successOn: z.int().min(2).max(100),
    maxPool: z.int().min(1).max(30),
    emptyPool: EmptyPoolSchema,
    bands: Bands,
    critical: CriticalRuleSchema,
  }),
  /** Roll a fixed number of dice; read their sum plus `points × pointValue`. (2d6+stat, d20+mod) */
  z.strictObject({
    method: z.literal('sum'),
    dice: z.int().min(1).max(10),
    sides: Sides,
    pointValue: z.int().min(1).max(10),
    bands: Bands,
    critical: CriticalRuleSchema,
  }),
]);
export type DiceRules = z.infer<typeof DiceRulesSchema>;

// --------------------------------------------------------------------- effect

/** How the final effect changes success-tier values (RUL §4.3). */
export const EffectScaleSchema = z.strictObject({
  harmLevels: z.int().min(-3).max(3), // added to harm the actor inflicts
  clockTicks: z.int().min(-3).max(3), // added to progress ticks
  treatmentLevels: z.int().min(0).max(5), // levels a treatment removes
});

// --------------------------------------------------------------------- harm

export const HarmTagDefinitionSchema = z.strictObject({
  id: StatusTagSchema, // e.g. "physical"
  name: z.string().min(1).max(40),
  description: z.string().max(300),
  hinders: z.array(StatIdSchema), // stats this harm penalizes
  resistStat: StatIdSchema.nullable(), // stat rolled to resist; null = cannot be resisted
  visible: z.boolean(), // whether others can see harm with this tag (GEAR-061)
});

export const HarmLevelDefinitionSchema = z.strictObject({
  name: z.string().min(1).max(40), // e.g. "Moderate"
  capacity: z.int().min(1).max(10).nullable(), // harms held at this level; null = unlimited
  pointPenalty: z.int().min(0).max(10), // per harm at this level, on hindered rolls
  effectPenalty: z.int().min(0).max(2), // once, if any harm at this level hinders the roll
  incapacitating: z.boolean(), // tells the GM the character cannot act in hindered ways
  untreatedHealMinutes: z.int().positive().nullable(), // null = does not heal untreated
  treatedHealMinutes: z.int().positive().nullable(),
  examples: z.string().max(300), // shown to the GM, e.g. "Deep Cut, Terrified"
});

// --------------------------------------------------------------------- ruleset

export const RelationshipDimensionSchema = z.strictObject({
  id: SlugSchema, // e.g. "trust"
  name: z.string().min(1).max(40),
  description: z.string().max(200), // tells the extractor what moves this dimension
});

export const RulesetSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: RulesetIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500),

  turns: z.strictObject({
    suggestedActions: z.enum(['off', 'always', 'on-request']),
    suggestedActionCount: z.int().min(1).max(6).default(3),
    /** When true, the player must accept every ruling before resolution, even without a roll. */
    confirmDirectRulings: z.boolean().default(false),
    /** When true, the player accepts each roll before narration (TRN-043). */
    confirmRolls: z.boolean().default(true),
  }),
  explanationLevel: z.enum(['off', 'player-safe', 'full']),
  /** Who may change statuses and clocks (RUL §9). */
  ownership: z.strictObject({ statuses: OwnershipSchema, clocks: OwnershipSchema }),

  stats: z.strictObject({
    list: z.array(StatDefinitionSchema).min(1).max(12),
    min: z.int().min(-5).max(1),
    max: z.int().min(1).max(20),
    default: z.int(), // rating for stats not given, e.g. NPCs introduced during play
  }),
  pcCreation: z.strictObject({
    statPoints: z.int(), // total of all starting ratings
    minStartingStat: z.int(),
    maxStartingStat: z.int(),
  }),

  dice: DiceRulesSchema,
  results: z.strictObject({
    /** Display names, e.g. PbtA's "Strong hit" for success. */
    labels: z.strictObject({
      critical: z.string().min(1).max(30),
      success: z.string().min(1).max(30),
      partial: z.string().min(1).max(30),
      failure: z.string().min(1).max(30),
    }),
  }),
  difficulty: z.strictObject({
    min: z.int().min(-10).max(0),
    max: z.int().min(0).max(10),
    /** Opposed actions start at `baseline − opponent's stat`; null = no formula. */
    opposedBaseline: z.int().min(-5).max(20).nullable(),
    /** Guidance for the GM, one line per value worth describing. */
    guide: z.array(z.strictObject({ value: z.int(), label: z.string().min(1).max(160) })).max(21),
  }),
  effect: z.strictObject({
    labels: z.strictObject({
      limited: z.string().min(1).max(30),
      standard: z.string().min(1).max(30),
      great: z.string().min(1).max(30),
    }),
    /** Base effect for each rating from `stats.min` to `stats.max`. */
    byRating: z.array(EffectLevelSchema).min(1),
    criticalBonus: z.int().min(0).max(2),
    scaling: z.strictObject({
      limited: EffectScaleSchema,
      standard: EffectScaleSchema,
      great: EffectScaleSchema,
    }),
  }),
  items: z.strictObject({
    maxRollBonus: z.int().min(0).max(10), // total roll-bonus points from items, per roll
    maxArmorPerHarm: z.int().min(0).max(3), // armor items that may reduce one harm
  }),

  harm: z.strictObject({
    tags: z.array(HarmTagDefinitionSchema).min(1).max(8),
    /** Level 1 first. Harm above the last level is fatal. */
    levels: z.array(HarmLevelDefinitionSchema).min(1).max(8),
    fatalName: z.string().min(1).max(40),
    overflow: z.enum(['up', 'none']), // 'none' ignores capacity
  }),
  resistance: z.strictObject({
    mode: z.enum(['auto', 'off']),
    who: z.enum(['pc', 'everyone']),
    /** Levels removed by each result of the resistance roll. */
    reduction: z.strictObject({
      critical: z.union([z.literal('negate'), z.int().min(0).max(9)]),
      success: z.union([z.literal('negate'), z.int().min(0).max(9)]),
      partial: z.union([z.literal('negate'), z.int().min(0).max(9)]),
      failure: z.union([z.literal('negate'), z.int().min(0).max(9)]),
    }),
  }),
  lethality: z.strictObject({ pc: LethalitySchema, npc: LethalitySchema }),

  clocks: z.strictObject({
    minSegments: z.int().min(2).max(24),
    maxSegments: z.int().min(2).max(24),
    maxTicks: z.int().min(1).max(6), // per consequence, before scaling
  }),
  statChange: z.strictObject({
    enabled: z.boolean(),
    clockSegments: z.int().min(2).max(24),
    amount: z.int().min(1).max(3),
    ticksPerWeek: z.number().min(0).max(7), // stat-change ticks per week of effort (TIME-091)
  }),

  relationships: z.strictObject({
    dimensions: z.array(RelationshipDimensionSchema).min(1).max(8),
    min: z.int().min(-100).max(0),
    max: z.int().min(1).max(100),
    maxChangePerTurn: z.int().min(1).max(100),
    /** 'auto': extraction also tracks the PC's feelings, from the player's input only (MEM-064). */
    trackPc: z.enum(['off', 'auto']),
  }),
  carrying: z.discriminatedUnion('mode', [
    z.strictObject({
      mode: z.literal('encumbrance'),
      baseCapacity: z.number().nonnegative(), // weight units at rating 0
      capacityPerPoint: z.number().nonnegative(),
      capacityStat: StatIdSchema, // which stat sets capacity
      encumberedStatus: z.string().min(1).max(80), // condition added while over capacity
      hardLimitMultiplier: z.number().min(1).max(10).nullable(), // moves past this × capacity fail
    }),
    z.strictObject({
      mode: z.literal('containers'),
      /** Space each item size takes in a container. */
      sizePoints: z.strictObject({
        tiny: z.int().min(1),
        small: z.int().min(1),
        medium: z.int().min(1),
        large: z.int().min(1),
        huge: z.int().min(1),
      }),
    }),
  ]),
});
export type Ruleset = z.infer<typeof RulesetSchema>;
```

**Invariants**

- **SCH-060** A ruleset describes a complete game system; what each field means is
  defined in `07-rules.md`, which owns rules semantics.
- **SCH-061** A ruleset must pass `rulesetIssues` (`07-rules.md` §12), which checks the
  cross-field rules a schema cannot: unique IDs, `effect.byRating` covering every
  rating, achievable PC creation, ordered bands, and references to existing stats.
- **SCH-062** Every problem `rulesetIssues` finds is reported together, as SCH-100
  requires for packs.

## 8. Settings, scenarios, and the pack manifest

### 8.1 `setting.ts`

```ts
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
```

### 8.2 `scenario.ts`

```ts
import { z } from 'zod';
import { EntityIdSchema } from '../primitives';
import { ContentSchemaVersionSchema, ScenarioIdSchema } from './common';
import { CalendarDateSchema } from './calendar';

export const ScenarioSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: ScenarioIdSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(1000), // shown in the new-campaign wizard
  start: CalendarDateSchema,
  startPlaceId: EntityIdSchema,
  /** Markdown file (relative to the pack): the opening situation, shown to the narrator (SCH-073). */
  openingFile: z.string().regex(/^[a-z0-9\-/]+\.md$/),
  presentEntityIds: z.array(EntityIdSchema),
  pc: z.discriminatedUnion('mode', [
    z.strictObject({ mode: z.literal('premade'), characterId: EntityIdSchema }),
    z.strictObject({
      mode: z.literal('player-created'),
      /** Guidance shown to the player and the GM, e.g. "a newcomer to town". */
      concept: z.string().max(600),
    }),
    z.strictObject({
      mode: z.literal('either'),
      characterId: EntityIdSchema,
      concept: z.string().max(600),
    }),
  ]),
});
export type Scenario = z.infer<typeof ScenarioSchema>;
```

**Invariants**

- **SCH-070** A scenario's `start` is at or after the setting's `epoch`, and every
  referenced entity exists in the pack.
- **SCH-071** For `mode: 'premade'` or `'either'`, `characterId` references a character
  with `kind: 'pc'`. A pack MAY contain several premade PCs; only the chosen one is
  instantiated in a campaign.
- **SCH-072** When the player creates their own PC, the new character is validated
  against the chosen ruleset's `stats` and `pcCreation`. A premade PC meets the same
  rules for the setting's default ruleset, so the player could have built it.
- **SCH-073** The opening file is given to the narrator for turn zero (CTX-076). It
  describes the situation as the PC finds it, uses only names the PC knows, and holds
  no secrets: truth belongs in history and canon, where knowledge boundaries apply.

### 8.3 Entities — `entities.ts`

```ts
import { z } from 'zod';
import { EntityIdSchema } from '../primitives';
import { StatBlockSchema, HarmLevelSchema, StatusTagSchema } from '../rules';
import {
  AgeCategorySchema,
  ContainerSchema,
  EntityMediaSchema,
  ItemBonusSchema,
  ItemLocationSchema,
  ItemSizeSchema,
  VoiceProfileSchema,
} from '../entities';

/*
 * Authoring formats. The loader converts these into runtime entities (03-contracts)
 * at campaign creation. Canon prose for an entity lives in a Markdown file with the
 * same base name, e.g. `characters/npc.varek.json` + `characters/npc.varek.md`.
 */

const AuthoredBase = {
  id: EntityIdSchema,
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().max(120)).default([]),
  tags: z.array(z.string().max(40)).default([]),
  media: EntityMediaSchema.optional(), // MED §3
};

export const AuthoredStatusSchema = z.strictObject({
  name: z.string().min(1).max(80),
  kind: z.enum(['harm', 'condition']),
  level: HarmLevelSchema.optional(),
  tags: z.array(StatusTagSchema),
  note: z.string().max(500).optional(),
});

export const AuthoredCharacterSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.enum(['pc', 'npc']),
  ageCategory: AgeCategorySchema,
  age: z.int().nonnegative().optional(),
  stats: StatBlockSchema,
  physicalDescription: z.string().max(1000),
  /** Short, always-in-context summary of how this character behaves. Longer detail goes in canon Markdown. */
  personality: z.string().min(1).max(600),
  /** Drives world ticks: characters with goals are active NPCs (12-time-world). */
  goals: z.array(z.string().min(1).max(200)).max(8).default([]),
  /** Always voiced by a separate call that sees only this character's knowledge (CTX §6). */
  keyNpc: z.boolean().default(false),
  voice: VoiceProfileSchema.optional(), // MED §5
  startingLocationId: EntityIdSchema.nullable(),
  startingStatuses: z.array(AuthoredStatusSchema).default([]),
});
export type AuthoredCharacter = z.infer<typeof AuthoredCharacterSchema>;

export const AuthoredPlaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.literal('place'),
  parentPlaceId: EntityIdSchema.nullable(),
  description: z.string().max(2000),
});

export const AuthoredFactionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.literal('faction'),
  description: z.string().max(2000),
  goals: z.array(z.string().min(1).max(200)).max(8).default([]),
});

export const AuthoredItemSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ...AuthoredBase,
  kind: z.literal('item'),
  description: z.string().max(1000),
  startingLocation: ItemLocationSchema,
  ownerId: EntityIdSchema.nullable().default(null),
  quantity: z.int().min(1).max(9999).default(1),
  weight: z.number().nonnegative().optional(),
  size: ItemSizeSchema.optional(),
  container: ContainerSchema.optional(),
  wearable: z
    .strictObject({
      slots: z.array(z.string().min(1)).min(1),
      covers: z.array(z.string().min(1)).default([]),
    })
    .optional(),
  bonuses: z.array(ItemBonusSchema).default([]),
});

export const AuthoredEntitySchema = z.discriminatedUnion('kind', [
  AuthoredCharacterSchema,
  AuthoredPlaceSchema,
  AuthoredFactionSchema,
  AuthoredItemSchema,
]);
export type AuthoredEntity = z.infer<typeof AuthoredEntitySchema>;
```

- **SCH-080** `personality` is short by design: it is included in context whenever the
  character is present. Everything longer belongs in the canon Markdown file.
- **SCH-081** A character with non-empty `goals` is an active NPC for world ticks.
- **SCH-082** Authored item locations follow the same invariants as runtime ones
  (CON-042, CON-043), including carrying limits (GEAR-053), checked against the
  campaign's resolved slot schema and ruleset.
- **SCH-083** `keyNpc: true` marks a character who, whenever involved in a turn, is
  voiced by a separate call that sees only their own knowledge (CTX-060). Use it for
  characters whose secrets drive the story. Characters holding a relevant secret are
  voiced this way automatically, so the flag is for those who should always be.

### 8.4 History and relationships — `seeds.ts`

History is how knowledge boundaries exist from the first turn. A secret is simply a
history entry that only its keeper witnessed.

```ts
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
```

**Invariants**

- **SCH-090** History `ref`s are unique within the file; `aboutRef` references an
  earlier entry in the file, since setup adds history in file order (SCH-117).
- **SCH-091** A dated entry's `when` is at or after the setting's `epoch`. Undated
  entries are background, stored at game time 0.
- **SCH-092** Seed relationships follow CON-073 and use dimensions from the ruleset's
  `relationships.dimensions`. When the pack loads, they are checked against the
  setting's default ruleset (SCH-114): a dimension it does not define, or a value outside
  its range, is an error. At campaign creation, dimensions not in the campaign's chosen
  ruleset are dropped with a warning, and values are clamped to its range.

## 9. Examples (reference pack)

These are excerpts of the complete reference pack, the fixture
`spec/fixtures/packs/reference/` (copied to `content-packs/reference/`, OVR-030). It has
seven characters (one a minor, to exercise the hard floor), six places, two factions,
twelve items, eleven history entries, and ten relationships. Where an excerpt below is
shortened, it says so; the fixture is the complete file.

### `pack.json`

```json
{
  "schemaVersion": 1,
  "id": "reference",
  "name": "Brinemoor (Reference Pack)",
  "version": "0.1.0",
  "description": "A small fog-bound fishing town. Used by tests and for first play.",
  "author": "Mythos"
}
```

### `setting.json`

```json
{
  "schemaVersion": 1,
  "id": "setting.brinemoor",
  "name": "Brinemoor",
  "summary": "Brinemoor is a fog-bound fishing town on a cold northern coast, in an era of oil lamps and sailing ships. The catch has been poor for two seasons, boats have gone missing, and the Tide Wardens who keep the harbor are stretched thin. There is no overt magic; the sea is the only monster anyone has proven exists.",
  "calendarId": "calendar.gregorian",
  "epoch": { "year": 1870, "month": 1, "day": 1 },
  "epochWeekday": 6,
  "slotSchemaId": "slots.everyday",
  "worldTickMinutes": 480,
  "defaults": { "toneProfileId": "tone.coastal-mystery", "rulesetId": "ruleset.standard" },
  "scenarioIds": ["scenario.arrival"]
}
```

### `calendar.gregorian.json` (built-in library: `spec/fixtures/library/calendars/`)

```json
{
  "schemaVersion": 1,
  "id": "calendar.gregorian",
  "name": "Gregorian",
  "months": [
    { "name": "January", "days": 31 },
    { "name": "February", "days": 28, "leapDays": 1 },
    { "name": "March", "days": 31 },
    { "name": "April", "days": 30 },
    { "name": "May", "days": 31 },
    { "name": "June", "days": 30 },
    { "name": "July", "days": 31 },
    { "name": "August", "days": 31 },
    { "name": "September", "days": 30 },
    { "name": "October", "days": 31 },
    { "name": "November", "days": 30 },
    { "name": "December", "days": 31 }
  ],
  "weekdays": ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  "leapRule": { "every": 4, "exceptEvery": 100, "unlessEvery": 400 },
  "timesOfDay": [
    { "name": "night", "startHour": 0 },
    { "name": "dawn", "startHour": 5 },
    { "name": "morning", "startHour": 7 },
    { "name": "midday", "startHour": 11 },
    { "name": "afternoon", "startHour": 13 },
    { "name": "evening", "startHour": 17 },
    { "name": "night", "startHour": 21 }
  ],
  "format": "{weekday}, {month} {day}, {year} ({timeOfDay})"
}
```

### `slot-schemas/slots.everyday.json`

```json
{
  "schemaVersion": 1,
  "id": "slots.everyday",
  "name": "Everyday clothing",
  "slots": [
    { "id": "head", "name": "Head", "layers": [{ "name": "worn", "visibility": "visible" }] },
    { "id": "torso", "name": "Torso", "layers": [
      { "name": "outer", "visibility": "visible" },
      { "name": "under", "visibility": "concealed" }
    ] },
    { "id": "legs", "name": "Legs", "layers": [
      { "name": "outer", "visibility": "visible" },
      { "name": "under", "visibility": "concealed" }
    ] },
    { "id": "feet", "name": "Feet", "layers": [{ "name": "worn", "visibility": "visible" }] },
    { "id": "hands", "name": "Hands", "layers": [{ "name": "worn", "visibility": "visible" }] },
    { "id": "neck", "name": "Neck", "layers": [{ "name": "worn", "visibility": "visible" }], "itemsPerLayer": 2 }
  ],
  "heldItems": 2
}
```

### `tone-profiles/tone.coastal-mystery.json`

```json
{
  "schemaVersion": 1,
  "id": "tone.coastal-mystery",
  "name": "Coastal Mystery",
  "description": "Slow-burn investigation in a closed community with secrets.",
  "genre": "low-fantasy mystery",
  "tone": "Melancholy, atmospheric, grounded. Everyone has a reason to lie. Danger is real but rarely theatrical. Moments of warmth matter because they are scarce.",
  "themes": ["secrets", "loyalty", "the sea as indifferent", "outsiders"],
  "narration": {
    "perspective": "second-person",
    "tense": "present",
    "length": "standard",
    "style": "Concrete sensory detail over adjectives. Let dialogue carry character. End on something the player can act on."
  },
  "pacing": "slow",
  "content": {
    "violence": "moderate",
    "gore": "fade-to-black",
    "sexual": "fade-to-black",
    "language": "moderate",
    "disturbing": "moderate",
    "lines": [],
    "veils": ["harm to animals"]
  },
  "themeId": "theme.brine",
  "artStyle": "muted oil painting, overcast light, desaturated blues and greys"
}
```

### `ruleset.standard.json` (built-in library: `spec/fixtures/library/rulesets/`)

The standard ruleset is described in `07-rules.md` §11. Three more example rulesets
sit beside it (07-rules Appendix A). All four ship in the built-in library.

### `scenarios/scenario.arrival.json`

```json
{
  "schemaVersion": 1,
  "id": "scenario.arrival",
  "name": "Arrival",
  "description": "You arrive in Brinemoor on the evening coach, looking for your missing brother.",
  "start": { "year": 1874, "month": 10, "day": 12, "hour": 18 },
  "startPlaceId": "place.gull-and-anchor",
  "openingFile": "scenarios/arrival.md",
  "presentEntityIds": ["npc.odette"],
  "pc": { "mode": "either", "characterId": "pc.wren", "concept": "An outsider searching for a missing sibling who crewed the Merrow's Luck." }
}
```

### `entities/characters/npc.varek.json` and `npc.varek.md`

```json
{
  "schemaVersion": 1,
  "id": "npc.varek",
  "kind": "npc",
  "name": "Varek Holm",
  "aliases": ["the clerk"],
  "ageCategory": "adult",
  "age": 41,
  "stats": { "str": 3, "end": 3, "dex": 4, "int": 4, "cha": 4 },
  "physicalDescription": "Lean, weathered, a pale scar through one eyebrow. Ink-stained fingers.",
  "personality": "Courteous, careful, never volunteers anything. Deflects with dry humor. Becomes very still when frightened.",
  "goals": ["Keep the truth about the Merrow's Luck buried", "Pay off his debt to the smugglers before winter"],
  "voice": { "description": "Low, dry, and unhurried; a clerk's careful diction that tightens when pressed." },
  "startingLocationId": "place.harbor-office"
}
```

```md
Varek has clerked at the harbor office for twelve years. Most of the town likes him
without knowing him. He keeps a ledger no one else has seen.

## Common knowledge

The harbor clerk. Courteous and dryly funny, and the one who signs every boat in and
out of Brinemoor.
```

The `## Common knowledge` section is what the player may read once Wren knows Varek
(JRN-031). The paragraph above it is truth, visible only in GM mode.

### `entities/items/item.fishing-knife.json`

A concealed item: worn in the `under` layer (index 1) of the `legs` slot. Its name
follows GEAR-065: lowercase, no article.

```json
{
  "schemaVersion": 1,
  "id": "item.fishing-knife",
  "kind": "item",
  "name": "fishing knife",
  "tags": ["weapon", "tool"],
  "description": "A short, thick-spined gutting knife in a leather sheath.",
  "startingLocation": { "type": "worn", "characterId": "pc.wren", "slot": "legs", "layer": 1 },
  "ownerId": "pc.wren",
  "size": "small",
  "wearable": { "slots": ["legs"] },
  "bonuses": [{ "type": "roll", "situation": "cutting rope, net, or line", "points": 1 }]
}
```

### `history.json`

The town believes the *Merrow's Luck* was lost at sea. Only Varek knows he sent her
out unseaworthy. Odette believes his lie about a squall. The truth store holds all
three; each character knows only what they witnessed or were told. Excerpt: the first
three of the fixture's eleven entries.

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "ref": "merrow-lost",
      "when": { "year": 1874, "month": 9, "day": 3 },
      "kind": "event",
      "text": "The fishing boat Merrow's Luck failed to return to Brinemoor. Her crew of five is presumed drowned.",
      "actorIds": [],
      "witnessIds": [],
      "importance": 8,
      "tags": ["merrows-luck"],
      "alsoKnownBy": [
        { "entityId": "npc.varek", "via": "rumor" },
        { "entityId": "npc.odette", "via": "rumor" },
        { "entityId": "npc.tomas", "via": "rumor" },
        { "entityId": "npc.pip", "via": "rumor" },
        { "entityId": "npc.ines-crale", "via": "rumor" }
      ]
    },
    {
      "ref": "merrow-scuttled",
      "when": { "year": 1874, "month": 9, "day": 2, "hour": 23 },
      "placeId": "place.harbor",
      "kind": "event",
      "text": "Varek Holm signed false papers letting the Merrow's Luck sail at night with smuggled cargo, knowing she was unseaworthy.",
      "actorIds": ["npc.varek"],
      "witnessIds": ["npc.varek"],
      "importance": 10,
      "tags": ["merrows-luck", "secret"]
    },
    {
      "ref": "varek-storm-story",
      "when": { "year": 1874, "month": 9, "day": 5, "hour": 20 },
      "placeId": "place.gull-and-anchor",
      "kind": "claim",
      "text": "Varek told Odette the Merrow's Luck was caught in a squall off the point.",
      "actorIds": ["npc.varek"],
      "witnessIds": ["npc.varek", "npc.odette"],
      "importance": 6,
      "tags": ["merrows-luck"],
      "claim": {
        "sourceId": "npc.varek",
        "audienceIds": ["npc.odette"],
        "content": "The Merrow's Luck was caught in a squall off the point.",
        "aboutRef": "merrow-lost",
        "truthful": "false"
      }
    }
  ]
}
```

### `relationships.json`

Excerpt: the first of the fixture's ten relationships.

```json
{
  "schemaVersion": 1,
  "relationships": [
    {
      "fromId": "npc.odette",
      "toId": "npc.varek",
      "dimensions": { "trust": 3, "affection": 2 },
      "summary": "Old friends. She thinks he is lonely, not secretive."
    }
  ]
}
```

## 10. Loading and validation

- **SCH-100** Loading a pack validates every file, then every cross-reference, then
  every invariant. It reports **all** errors found, not just the first.
- **SCH-101** Each error names the file path, the JSON path within it, and what was
  expected, e.g. `entities/items/item.lantern.json: startingLocation.slot: "belt" is
  not a slot in slots.everyday`.
- **SCH-102** A pack with errors cannot be used to create a campaign. It is listed in
  the library screen with its errors.
- **SCH-103** Loading is pure apart from reading files: the same files always produce
  the same result and the same errors.

## 11. Campaign creation

- **SCH-110** Creating a campaign takes: a pack, a scenario from it, a tone profile, a
  ruleset, and either the scenario's premade PC or a player-created PC.
- **SCH-111** The engine snapshots the resolved setting, calendar, slot schema (the
  tone profile's override if present), tone profile, ruleset, scenario, all entities
  and their canon, history, relationships, and templates into the campaign database.
  From then on the campaign never reads the pack (ARCH-045).
- **SCH-112** Campaign creation produces the campaign's first turn, whose commit sets
  (origin `engine`) create every entity, convert history entries into observations and
  knowledge grants, seed relationships, set game time to the scenario start, and start
  the first scene. It is a normal turn: inspectable in the context inspector and the
  root of every branch.
- **SCH-113** Only the chosen PC is instantiated. Premade PCs not chosen are omitted.
- **SCH-114** A pack's characters are authored against the setting's default ruleset
  (`defaults.rulesetId`, or `ruleset.standard` if absent). If the campaign uses a
  ruleset with different stat IDs or harm tags, the new-campaign wizard asks for a
  **conversion**: each new stat takes either an old stat's rating, rescaled linearly
  from the old range to the new one and rounded, or a fixed rating; each old harm tag
  maps to a new one. Item bonuses naming an unmapped stat apply to any stat. The
  conversion is stored in the campaign's setup turn so it can be inspected.
- **SCH-115** In an `either` scenario, a player-created PC takes the premade PC's place
  in the story: every reference to the premade PC's ID in history, relationships, and
  items (location and owner) is rewritten to the new PC's ID. The premade PC's name,
  stats, descriptions, and canon are not used. In the reference pack, a player-created
  PC is still Jory's sibling, has received both letters, and starts wearing Wren's
  clothes.
- **SCH-116** References to any other PC that is not instantiated are removed at
  creation: the PC is dropped from actor, witness, audience, and `alsoKnownBy` lists;
  a history entry whose claim source is that PC is dropped; relationships from or to
  it are dropped; items it possesses are omitted; items it only owns become ownerless.
  Each removal is listed in the setup turn as a warning.
- **SCH-117** Setup is a single `setup` set on the root turn. Its commits, in order:
  1. `entity.create` for every entity in runtime form (SCH-005): places, then
     factions, then characters, then items, each kind sorted by ID with `cmp`, except
     that a parent place always comes before the places inside it, and a container
     before the items inside it. Characters start
     `alive` with their `startingStatuses`.
  2. `time.advance` from game time 0 (the setting's epoch) to the scenario's `start`,
     unless they are equal.
  3. `entity.move` to the scenario's `startPlaceId` for the PC and each entity in
     `presentEntityIds` that starts elsewhere, then `scene.start` there with a new
     scene ID.
  4. For each history entry, in file order: `observation.add` with the entry's kind,
     text, actors, witnesses, place, importance, and tags, no mentions, and `gameTime`
     from `when` (0 when undated), its claim's `aboutRef` resolved to that entry's
     observation; then `knowledge.grant` for each witness (`witnessed`, CON-071), each
     claim audience member who is not a witness (`told`, MEM-034), and each
     `alsoKnownBy` entry (its own `via`, MEM-035), all at the observation's game time.
     History is not checked against MEM-011: witnesses were where the history says.
  5. `relationship.set` for each seed relationship (SCH-092).
  6. `knowledge.name` for the PC for every other character named in a history entry
     the PC knows: actors, witnesses, and a claim's source and audience (JRN-022).
- **SCH-118** Folding starts from an initial world state built from the campaign
  record: game time 0, no entities, clocks, or flags, the chosen PC's ID, the
  scenario's start place, and the first scene's ID, which setup's `scene.start` then
  records.

## Decisions

| Question | Decision | Rejected and why | Decided by |
|---|---|---|---|
| How does SCH-001 catch an unknown key inside `media`, `voice`, `startingLocation`, `container`, or `bonuses`? Authored entities reuse runtime schemas there that are not strict, so Zod drops the key silently. | The loader compares each of those objects' keys with its schema's shape (for `startingLocation` and each bonus, the variant its `type` names) and reports every unknown key at its path. The contracts are unchanged. | Strict runtime schemas: they also parse stored state and commit payloads, so the change would reach far beyond authored files. | owner |
| Which library problems does a pack report (SCH-100)? | Only problems in library definitions the pack uses (its calendar, slot schema, default tone profile and ruleset, and the themes and slot schemas its tone profiles name), each under the library file. A broken library definition is offered to no pack, and is logged. | Every library problem in every pack: one broken user ruleset would block every pack, even those that never use it. | owner |
| What is `PackIssue.file` for a library file (SCH-101)? | A relative path starting with the library's folder: `content-library/…` for the built-in library, `library/…` for the user library. Never absolute. | Absolute paths: they differ between machines and between Windows and macOS, so the same files would not give the same errors (SCH-103). | owner |
| Both pack folders hold a pack with the same ID (§2). | The data directory's pack is used, and a warning is logged. | The repository's pack: an edited copy in the data directory would be ignored. Refusing both: a copy could break the reference pack. | owner |
| May a history claim's `aboutRef` name a later entry (SCH-090)? | No: it names an earlier entry in `history.json`, and the loader reports one that names a later entry. Setup adds history in file order and the fold checks each commit against what came before it (SCH-117), so a claim about a later entry would load and then fail at campaign creation. | Resolving `aboutRef` after every entry is added: setup would need a second pass over history. | owner |
