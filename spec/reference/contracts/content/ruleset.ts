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
