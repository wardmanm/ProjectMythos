// Ruleset checks (07-rules §12): the cross-field rules a schema cannot express, and the
// limits that narrow the model-facing ruling schema to one ruleset.
import type { EffectLevel, RulingLimits } from '@mythos/contracts';
import type { Ruleset } from '@mythos/contracts/content';

const EFFECT_ORDER: readonly EffectLevel[] = ['limited', 'standard', 'great'];

/** Each value that appears more than once, listed once, in first-seen order. */
function duplicates(values: readonly string[]): string[] {
  const repeated = values.filter((value, index) => values.indexOf(value) !== index);
  return [...new Set(repeated)];
}

function statIssues(ruleset: Ruleset): string[] {
  const issues: string[] = [];
  const { stats, effect, pcCreation, difficulty } = ruleset;
  const statIds = stats.list.map((stat) => stat.id);
  const repeated = duplicates(statIds);
  if (repeated.length > 0) issues.push(`stats.list: duplicate ids ${repeated.join(', ')}`);
  if (stats.min >= stats.max) issues.push('stats: min must be below max');
  if (stats.default < stats.min || stats.default > stats.max) {
    issues.push('stats.default: outside stats.min..max');
  }

  const span = stats.max - stats.min + 1;
  if (effect.byRating.length !== span) {
    issues.push(
      `effect.byRating: needs ${String(span)} entries (one per rating ${String(stats.min)}..${String(stats.max)}), has ${String(effect.byRating.length)}`,
    );
  }
  const ranks = effect.byRating.map((level) => EFFECT_ORDER.indexOf(level));
  if (ranks.some((rank, index) => index > 0 && rank < (ranks[index - 1] ?? rank))) {
    issues.push('effect.byRating: must not decrease as rating rises');
  }

  const { minStartingStat, maxStartingStat, statPoints } = pcCreation;
  if (
    minStartingStat < stats.min ||
    maxStartingStat > stats.max ||
    minStartingStat > maxStartingStat
  ) {
    issues.push('pcCreation: starting stat range must sit inside stats.min..max');
  }
  if (
    statPoints < statIds.length * minStartingStat ||
    statPoints > statIds.length * maxStartingStat
  ) {
    issues.push('pcCreation.statPoints: not achievable with the starting stat range');
  }

  if (difficulty.min > 0 || difficulty.max < 0) issues.push('difficulty: range must include 0');
  for (const guide of difficulty.guide) {
    if (guide.value < difficulty.min || guide.value > difficulty.max) {
      issues.push(`difficulty.guide: ${String(guide.value)} is outside the range`);
    }
  }
  return issues;
}

function diceIssues(ruleset: Ruleset): string[] {
  const issues: string[] = [];
  const dice = ruleset.dice;
  const mins = dice.bands.map((band) => band.min);
  if (mins.some((min, index) => index > 0 && min >= (mins[index - 1] ?? min))) {
    issues.push('dice.bands: order by min, highest first, without repeats');
  }
  if (dice.critical.type === 'faces' && dice.critical.face > dice.sides) {
    issues.push('dice.critical.face: larger than dice.sides');
  }
  if (dice.method === 'pool-count' && dice.successOn > dice.sides) {
    issues.push('dice.successOn: larger than dice.sides');
  }
  if (dice.method !== 'sum' && dice.maxPool < ruleset.stats.max) {
    issues.push('dice.maxPool: smaller than the highest stat rating');
  }
  return issues;
}

function harmAndOtherIssues(ruleset: Ruleset): string[] {
  const issues: string[] = [];
  const { harm, clocks, statChange, relationships, carrying } = ruleset;
  const statIds = new Set(ruleset.stats.list.map((stat) => stat.id));

  const repeatedTags = duplicates(harm.tags.map((tag) => tag.id));
  if (repeatedTags.length > 0) issues.push(`harm.tags: duplicate ids ${repeatedTags.join(', ')}`);
  for (const tag of harm.tags) {
    for (const stat of tag.hinders) {
      if (!statIds.has(stat)) issues.push(`harm.tags.${tag.id}.hinders: unknown stat ${stat}`);
    }
    if (tag.resistStat !== null && !statIds.has(tag.resistStat)) {
      issues.push(`harm.tags.${tag.id}.resistStat: unknown stat ${tag.resistStat}`);
    }
  }

  if (clocks.minSegments > clocks.maxSegments) issues.push('clocks: minSegments above maxSegments');
  if (
    statChange.clockSegments < clocks.minSegments ||
    statChange.clockSegments > clocks.maxSegments
  ) {
    issues.push('statChange.clockSegments: outside clocks.minSegments..maxSegments');
  }

  if (relationships.min > 0) issues.push('relationships.min: must be 0 or below');
  if (relationships.maxChangePerTurn > relationships.max - relationships.min) {
    issues.push('relationships.maxChangePerTurn: larger than the whole range');
  }
  const repeatedDimensions = duplicates(relationships.dimensions.map((dimension) => dimension.id));
  if (repeatedDimensions.length > 0) {
    issues.push(`relationships.dimensions: duplicate ids ${repeatedDimensions.join(', ')}`);
  }

  if (carrying.mode === 'encumbrance' && !statIds.has(carrying.capacityStat)) {
    issues.push(`carrying.capacityStat: unknown stat ${carrying.capacityStat}`);
  }
  return issues;
}

/**
 * Every cross-field problem in a ruleset, all reported together; empty when it can be
 * used. Implements RUL-002, SCH-061, and SCH-062.
 */
export function rulesetIssues(ruleset: Ruleset): string[] {
  return [...statIssues(ruleset), ...diceIssues(ruleset), ...harmAndOtherIssues(ruleset)];
}

/**
 * The limits that narrow the model-facing ruling schema to this ruleset's stats, tags,
 * and ranges (CON-035). Implements RUL-065.
 */
export function rulingLimitsFor(ruleset: Ruleset): RulingLimits {
  const [firstStat, ...otherStats] = ruleset.stats.list.map((stat) => stat.id);
  const [firstTag, ...otherTags] = ruleset.harm.tags.map((tag) => tag.id);
  return {
    statIds: firstStat === undefined ? null : [firstStat, ...otherStats],
    tagIds: firstTag === undefined ? null : [firstTag, ...otherTags],
    difficulty: { min: ruleset.difficulty.min, max: ruleset.difficulty.max },
    maxHarmLevel: ruleset.harm.levels.length + 1,
    clockSegments: { min: ruleset.clocks.minSegments, max: ruleset.clocks.maxSegments },
    maxTicks: ruleset.clocks.maxTicks,
  };
}
