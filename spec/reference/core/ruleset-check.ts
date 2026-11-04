import type { Ruleset } from '@mythos/contracts/content';

/** Cross-field checks a schema cannot express (SCH-062). Returns every problem found. */
export function rulesetIssues(r: Ruleset): string[] {
  const issues: string[] = [];
  const stats = r.stats.list.map((s) => s.id);
  const isStat = (id: string) => stats.includes(id);
  const dupes = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);

  if (dupes(stats).length) issues.push(`stats.list: duplicate ids ${dupes(stats).join(', ')}`);
  if (r.stats.min >= r.stats.max) issues.push("stats: min must be below max");
  if (r.stats.default < r.stats.min || r.stats.default > r.stats.max) issues.push("stats.default: outside stats.min..max");
  const span = r.stats.max - r.stats.min + 1;
  if (r.effect.byRating.length !== span)
    issues.push(`effect.byRating: needs ${span} entries (one per rating ${r.stats.min}..${r.stats.max}), has ${r.effect.byRating.length}`);
  const order = ['limited', 'standard', 'great'];
  r.effect.byRating.forEach((e, i) => {
    const prev = r.effect.byRating[i - 1];
    if (prev !== undefined && order.indexOf(e) < order.indexOf(prev)) issues.push('effect.byRating: must not decrease as rating rises');
  });
  const pc = r.pcCreation;
  if (pc.minStartingStat < r.stats.min || pc.maxStartingStat > r.stats.max || pc.minStartingStat > pc.maxStartingStat)
    issues.push('pcCreation: starting stat range must sit inside stats.min..max');
  if (pc.statPoints < stats.length * pc.minStartingStat || pc.statPoints > stats.length * pc.maxStartingStat)
    issues.push('pcCreation.statPoints: not achievable with the starting stat range');
  if (r.difficulty.min > 0 || r.difficulty.max < 0) issues.push('difficulty: range must include 0');
  for (const g of r.difficulty.guide)
    if (g.value < r.difficulty.min || g.value > r.difficulty.max) issues.push(`difficulty.guide: ${g.value} is outside the range`);

  const d = r.dice;
  d.bands.forEach((b, i) => {
    const prev = d.bands[i - 1];
    if (prev && b.min >= prev.min) issues.push('dice.bands: order by min, highest first, without repeats');
  });
  if (d.critical.type === 'faces' && d.critical.face > d.sides) issues.push('dice.critical.face: larger than dice.sides');
  if (d.method === 'pool-count' && d.successOn > d.sides) issues.push('dice.successOn: larger than dice.sides');
  if (d.method !== 'sum' && d.maxPool < r.stats.max) issues.push('dice.maxPool: smaller than the highest stat rating');

  const tags = r.harm.tags.map((t) => t.id);
  if (dupes(tags).length) issues.push(`harm.tags: duplicate ids ${dupes(tags).join(', ')}`);
  for (const t of r.harm.tags) {
    for (const s of t.hinders) if (!isStat(s)) issues.push(`harm.tags.${t.id}.hinders: unknown stat ${s}`);
    if (t.resistStat !== null && !isStat(t.resistStat)) issues.push(`harm.tags.${t.id}.resistStat: unknown stat ${t.resistStat}`);
  }
  if (r.clocks.minSegments > r.clocks.maxSegments) issues.push('clocks: minSegments above maxSegments');
  if (r.statChange.clockSegments < r.clocks.minSegments || r.statChange.clockSegments > r.clocks.maxSegments)
    issues.push('statChange.clockSegments: outside clocks.minSegments..maxSegments');
  if (r.relationships.min > 0) issues.push('relationships.min: must be 0 or below');
  if (r.relationships.maxChangePerTurn > r.relationships.max - r.relationships.min)
    issues.push('relationships.maxChangePerTurn: larger than the whole range');
  const dims = r.relationships.dimensions.map((x) => x.id);
  if (dupes(dims).length) issues.push(`relationships.dimensions: duplicate ids ${dupes(dims).join(', ')}`);
  if (r.carrying.mode === 'encumbrance' && !isStat(r.carrying.capacityStat))
    issues.push(`carrying.capacityStat: unknown stat ${r.carrying.capacityStat}`);
  return issues;
}

import type { RulingLimits } from '@mythos/contracts';
/** Narrows the model-facing ruling schema to this ruleset (RUL-065, CON-035). */
export function rulingLimitsFor(r: Ruleset): RulingLimits {
  const [s0, ...sRest] = r.stats.list.map((s) => s.id);
  const [t0, ...tRest] = r.harm.tags.map((t) => t.id);
  return {
    statIds: s0 ? [s0, ...sRest] : null,
    tagIds: t0 ? [t0, ...tRest] : null,
    difficulty: { min: r.difficulty.min, max: r.difficulty.max },
    maxHarmLevel: r.harm.levels.length + 1,
    clockSegments: { min: r.clocks.minSegments, max: r.clocks.maxSegments },
    maxTicks: r.clocks.maxTicks,
  };
}
