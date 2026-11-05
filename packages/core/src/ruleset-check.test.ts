import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Ruleset, RulesetSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { rulesetIssues, rulingLimitsFor } from './ruleset-check';

const rulesetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../content-library/rulesets',
);
const load = (file: string): Ruleset =>
  RulesetSchema.parse(JSON.parse(readFileSync(path.join(rulesetsDir, file), 'utf8')));
const rulesetFiles = readdirSync(rulesetsDir).filter((file) => file.endsWith('.json'));

const standard = load('ruleset.standard.json');
const d10Pool = load('ruleset.d10-pool.json');
const [physical, mental, social] = standard.harm.tags;
const [trust] = standard.relationships.dimensions;
if (physical === undefined || mental === undefined || social === undefined || trust === undefined) {
  throw new Error('the standard ruleset has changed shape');
}
const str = standard.stats.list[0];
if (str === undefined) throw new Error('the standard ruleset has no stats');
// Narrowed, so a spread keeps each dice method's own fields.
const standardDice = standard.dice;
const d10Dice = d10Pool.dice;
if (standardDice.method !== 'pool-highest' || d10Dice.method !== 'pool-count') {
  throw new Error('a library ruleset has changed dice method');
}

const encumbrance = (capacityStat: string): Ruleset['carrying'] => ({
  mode: 'encumbrance',
  baseCapacity: 10,
  capacityPerPoint: 5,
  capacityStat,
  encumberedStatus: 'Encumbered',
  hardLimitMultiplier: 2,
});

// Each case breaks one rule of 07-rules §12 and expects exactly its message.
const broken: [string, Ruleset, string[]][] = [
  [
    'a duplicate stat ID',
    { ...standard, stats: { ...standard.stats, list: [...standard.stats.list, str] } },
    ['stats.list: duplicate ids str'],
  ],
  [
    'stats.min not below stats.max',
    {
      ...standard,
      stats: { ...standard.stats, min: 3, max: 3, default: 3 },
      effect: { ...standard.effect, byRating: ['standard'] },
      pcCreation: { statPoints: 15, minStartingStat: 3, maxStartingStat: 3 },
    },
    ['stats: min must be below max'],
  ],
  [
    'a default rating outside the range',
    { ...standard, stats: { ...standard.stats, default: 9 } },
    ['stats.default: outside stats.min..max'],
  ],
  [
    'too few effect ratings',
    { ...standard, effect: { ...standard.effect, byRating: ['limited', 'standard', 'great'] } },
    ['effect.byRating: needs 5 entries (one per rating 1..5), has 3'],
  ],
  [
    'effect falling as rating rises, reported once',
    {
      ...standard,
      effect: {
        ...standard.effect,
        byRating: ['great', 'standard', 'limited', 'standard', 'limited'],
      },
    },
    ['effect.byRating: must not decrease as rating rises'],
  ],
  [
    'a starting range beyond the stat range',
    { ...standard, pcCreation: { ...standard.pcCreation, maxStartingStat: 6 } },
    ['pcCreation: starting stat range must sit inside stats.min..max'],
  ],
  [
    'unreachable starting stat points',
    { ...standard, pcCreation: { ...standard.pcCreation, statPoints: 25 } },
    ['pcCreation.statPoints: not achievable with the starting stat range'],
  ],
  [
    'a difficulty range without 0',
    { ...standard, difficulty: { ...standard.difficulty, min: 1, guide: [] } },
    ['difficulty: range must include 0'],
  ],
  [
    'a guide value outside the range',
    { ...standard, difficulty: { ...standard.difficulty, guide: [{ value: 5, label: 'x' }] } },
    ['difficulty.guide: 5 is outside the range'],
  ],
  [
    'bands out of order',
    {
      ...standard,
      dice: {
        ...standard.dice,
        bands: [
          { min: 4, result: 'partial' },
          { min: 6, result: 'success' },
          { min: 1, result: 'failure' },
        ],
      },
    },
    ['dice.bands: order by min, highest first, without repeats'],
  ],
  [
    'a repeated band',
    {
      ...standard,
      dice: {
        ...standard.dice,
        bands: [
          { min: 6, result: 'success' },
          { min: 6, result: 'partial' },
        ],
      },
    },
    ['dice.bands: order by min, highest first, without repeats'],
  ],
  [
    'a critical face beyond the die',
    { ...standard, dice: { ...standard.dice, critical: { type: 'faces', face: 8, count: 2 } } },
    ['dice.critical.face: larger than dice.sides'],
  ],
  [
    'a success threshold beyond the die',
    { ...d10Pool, dice: { ...d10Dice, successOn: 12 } },
    ['dice.successOn: larger than dice.sides'],
  ],
  [
    'a pool smaller than the highest rating',
    { ...standard, dice: { ...standardDice, maxPool: 4 } },
    ['dice.maxPool: smaller than the highest stat rating'],
  ],
  [
    'a duplicate harm tag ID',
    { ...standard, harm: { ...standard.harm, tags: [physical, mental, social, physical] } },
    ['harm.tags: duplicate ids physical'],
  ],
  [
    'a harm tag hindering an unknown stat',
    {
      ...standard,
      harm: { ...standard.harm, tags: [{ ...physical, hinders: ['str', 'luck'] }, mental, social] },
    },
    ['harm.tags.physical.hinders: unknown stat luck'],
  ],
  [
    'a harm tag resisted by an unknown stat',
    {
      ...standard,
      harm: { ...standard.harm, tags: [physical, mental, { ...social, resistStat: 'luck' }] },
    },
    ['harm.tags.social.resistStat: unknown stat luck'],
  ],
  [
    'clock limits reversed',
    { ...standard, clocks: { ...standard.clocks, minSegments: 12, maxSegments: 4 } },
    [
      'clocks: minSegments above maxSegments',
      'statChange.clockSegments: outside clocks.minSegments..maxSegments',
    ],
  ],
  [
    'a stat-change clock outside the clock limits',
    { ...standard, statChange: { ...standard.statChange, clockSegments: 20 } },
    ['statChange.clockSegments: outside clocks.minSegments..maxSegments'],
  ],
  [
    'a relationship minimum above 0',
    { ...standard, relationships: { ...standard.relationships, min: 1 } },
    ['relationships.min: must be 0 or below'],
  ],
  [
    'a per-turn change wider than the range',
    { ...standard, relationships: { ...standard.relationships, maxChangePerTurn: 20 } },
    ['relationships.maxChangePerTurn: larger than the whole range'],
  ],
  [
    'a duplicate relationship dimension',
    {
      ...standard,
      relationships: {
        ...standard.relationships,
        dimensions: [...standard.relationships.dimensions, trust],
      },
    },
    ['relationships.dimensions: duplicate ids trust'],
  ],
  [
    'an unknown capacity stat',
    { ...standard, carrying: encumbrance('luck') },
    ['carrying.capacityStat: unknown stat luck'],
  ],
];

describe('rulesetIssues', () => {
  it('RUL-002: the built-in library has rulesets to check', () => {
    expect(rulesetFiles.length).toBe(4);
  });

  it.each(rulesetFiles)('RUL-002: %s has no issues', (file) => {
    expect(rulesetIssues(load(file))).toEqual([]);
  });

  it('RUL-002: an encumbrance ruleset whose capacity stat exists has no issues', () => {
    expect(rulesetIssues({ ...standard, carrying: encumbrance('str') })).toEqual([]);
  });

  it.each(broken)('RUL-002: %s is reported', (_name, ruleset, expected) => {
    expect(rulesetIssues(ruleset)).toEqual(expected);
  });

  it('SCH-062: every problem in one ruleset is reported together', () => {
    const many: Ruleset = {
      ...standard,
      stats: { ...standard.stats, default: 9 },
      effect: { ...standard.effect, byRating: ['great', 'limited', 'standard'] },
      dice: { ...standardDice, maxPool: 4 },
      harm: { ...standard.harm, tags: [{ ...physical, resistStat: 'luck' }, mental, social] },
      relationships: { ...standard.relationships, min: 1 },
    };
    expect(rulesetIssues(many)).toEqual([
      'stats.default: outside stats.min..max',
      'effect.byRating: needs 5 entries (one per rating 1..5), has 3',
      'effect.byRating: must not decrease as rating rises',
      'dice.maxPool: smaller than the highest stat rating',
      'harm.tags.physical.resistStat: unknown stat luck',
      'relationships.min: must be 0 or below',
    ]);
  });
});

describe('rulingLimitsFor', () => {
  it("RUL-065: the standard ruleset's stats, tags, and ranges narrow the ruling schema", () => {
    expect(rulingLimitsFor(standard)).toEqual({
      statIds: ['str', 'end', 'dex', 'int', 'cha'],
      tagIds: ['physical', 'mental', 'social'],
      difficulty: { min: -3, max: 3 },
      maxHarmLevel: 4,
      clockSegments: { min: 2, max: 12 },
      maxTicks: 3,
    });
  });

  it('RUL-065: a ruleset with no stats or tags leaves their IDs open', () => {
    const empty = {
      ...standard,
      stats: { ...standard.stats, list: [] },
      harm: { ...standard.harm, tags: [] },
    };
    expect(rulingLimitsFor(empty).statIds).toBeNull();
    expect(rulingLimitsFor(empty).tagIds).toBeNull();
  });
});
