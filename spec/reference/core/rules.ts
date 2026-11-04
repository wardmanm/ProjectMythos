import type {
  EffectLevel, HarmLevel, PlannedConsequence, Roll, RollModifier, RollResult, StatId, Status,
} from '@mythos/contracts';
import type { DiceRules, Ruleset } from '@mythos/contracts/content';

/** Injected randomness (CONV-061): returns an integer 1..sides. */
export type Rng = { roll(sides: number): number };
const EFFECTS: EffectLevel[] = ['limited', 'standard', 'great'];
const shiftEffect = (e: EffectLevel, by: number): EffectLevel =>
  EFFECTS[Math.max(0, Math.min(2, EFFECTS.indexOf(e) + by))] as EffectLevel;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ================================================================ reading dice (RUL §3.3)

export function bandResult(value: number, rules: DiceRules): RollResult {
  for (const b of rules.bands) if (value >= b.min) return b.result;
  return (rules.bands[rules.bands.length - 1] as { result: RollResult }).result; // unreachable when RUL-031 holds
}

function isCritical(kept: number[], rules: DiceRules): boolean {
  const c = rules.critical;
  return c.type === 'faces' && kept.filter((d) => d === c.face).length >= c.count;
}

/** How many dice to roll, and which to keep. */
export function diceToRoll(points: number, rules: DiceRules): { count: number; keep: 'all' | 'lowest' | 'highest' } {
  if (rules.method === 'sum') return { count: rules.dice, keep: 'all' };
  if (points <= 0) return { count: rules.emptyPool.roll, keep: rules.emptyPool.keep };
  return { count: Math.min(points, rules.maxPool), keep: 'all' };
}

export function readDice(dice: number[], points: number, rules: DiceRules): { kept: number[]; total: number; result: RollResult } {
  const { keep } = diceToRoll(points, rules);
  const kept = keep === 'all' ? dice : [keep === 'lowest' ? Math.min(...dice) : Math.max(...dice)];
  const total =
    rules.method === 'pool-highest' ? Math.max(...kept)
    : rules.method === 'pool-count' ? kept.filter((d) => d >= rules.successOn).length
    : sum(kept) + points * rules.pointValue;
  return { kept, total, result: isCritical(kept, rules) ? 'critical' : bandResult(total, rules) };
}

/** Exact odds by dynamic programming over dice. */
export function odds(points: number, rules: DiceRules): Record<RollResult, number> {
  const out: Record<RollResult, number> = { critical: 0, success: 0, partial: 0, failure: 0 };
  const { count, keep } = diceToRoll(points, rules);
  const s = rules.sides;
  const crit = rules.critical;
  // Distribution over (accumulator, critical-face count), one die at a time.
  type Key = string;
  let dist = new Map<Key, number>([['init|0', 1]]);
  const dieCount = keep === 'all' ? count : 1;
  const singleKept = (v: number): number => {
    // Probability the kept die (lowest or highest of `count`) equals v.
    if (keep === 'lowest') return ((s - v + 1) / s) ** count - ((s - v) / s) ** count;
    return (v / s) ** count - ((v - 1) / s) ** count;
  };
  for (let i = 0; i < dieCount; i++) {
    const next = new Map<Key, number>();
    for (const [key, p] of dist) {
      const [accRaw, cRaw] = key.split('|');
      const c = Number(cRaw);
      for (let v = 1; v <= s; v++) {
        const pv = keep === 'all' ? 1 / s : singleKept(v);
        let acc: number;
        if (rules.method === 'pool-highest') acc = accRaw === 'init' ? v : Math.max(Number(accRaw), v);
        else if (rules.method === 'pool-count') acc = (accRaw === 'init' ? 0 : Number(accRaw)) + (v >= rules.successOn ? 1 : 0);
        else acc = (accRaw === 'init' ? 0 : Number(accRaw)) + v;
        const cc = crit.type === 'faces' && v === crit.face ? Math.min(crit.count, c + 1) : c;
        const k = `${acc}|${cc}`;
        next.set(k, (next.get(k) ?? 0) + p * pv);
      }
    }
    dist = next;
  }
  for (const [key, p] of dist) {
    const [acc, c] = key.split('|').map(Number) as [number, number];
    const total = rules.method === 'sum' ? acc + points * rules.pointValue : acc;
    const isCrit = crit.type === 'faces' && c >= crit.count;
    out[isCrit ? 'critical' : bandResult(total, rules)] += p;
  }
  return out;
}

// ================================================================ harm penalties (RUL §6.4)

export function harmPenalties(statuses: Status[], stat: StatId, ruleset: Ruleset) {
  const hinders = (s: Status) => s.tags.some((t) => ruleset.harm.tags.find((d) => d.id === t)?.hinders.includes(stat));
  const relevant = statuses.filter((s) => s.kind === 'harm' && !s.permanent && s.level !== undefined && hinders(s));
  const points: RollModifier[] = [];
  const effect: RollModifier[] = [];
  const effectLevelsSeen = new Set<number>();
  for (const s of relevant) {
    const def = ruleset.harm.levels[(s.level as number) - 1];
    if (!def) continue;
    if (def.pointPenalty > 0) points.push({ source: 'harm', label: `${s.name} (${def.name})`, value: -def.pointPenalty });
    if (def.effectPenalty > 0 && !effectLevelsSeen.has(s.level as number)) {
      effectLevelsSeen.add(s.level as number);
      effect.push({ source: 'harm', label: `${s.name} (${def.name})`, value: -def.effectPenalty });
    }
  }
  return { points, effect };
}

// ================================================================ action roll (RUL §3)

export function actionRoll(args: {
  stat: StatId; rating: number; difficulty: number; itemBonuses: RollModifier[];
  statuses: Status[]; effectModifier: number; ruleset: Ruleset; rng: Rng;
}): Roll {
  const { ruleset } = args;
  const harm = harmPenalties(args.statuses, args.stat, ruleset);
  const items: RollModifier[] = [];
  let remaining = ruleset.items.maxRollBonus;
  for (const m of args.itemBonuses) {
    const v = Math.min(remaining, m.value);
    if (v > 0) items.push({ ...m, value: v });
    remaining -= v;
  }
  const modifiers = [...items, ...harm.points];
  const points = args.rating + args.difficulty + sum(modifiers.map((m) => m.value));
  const { count } = diceToRoll(points, ruleset.dice);
  const dice = Array.from({ length: count }, () => args.rng.roll(ruleset.dice.sides));
  const { kept, total, result } = readDice(dice, points, ruleset.dice);
  const effectModifiers: RollModifier[] = [...harm.effect];
  if (args.effectModifier !== 0) effectModifiers.push({ source: 'ruling', label: 'Situation', value: args.effectModifier });
  if (result === 'critical' && ruleset.effect.criticalBonus > 0)
    effectModifiers.push({ source: 'critical', label: ruleset.results.labels.critical, value: ruleset.effect.criticalBonus });
  const base = ruleset.effect.byRating[args.rating - ruleset.stats.min] as EffectLevel;
  const effect = shiftEffect(base, sum(effectModifiers.map((m) => m.value)));
  return { stat: args.stat, rating: args.rating, difficulty: args.difficulty, modifiers, points,
    method: ruleset.dice.method, sides: ruleset.dice.sides, dice, kept, total, result, effectModifiers, effect };
}

/** Resistance: the stat's rating only; no difficulty, items, or harm (RUL-084). */
export function resistanceRoll(stat: StatId, rating: number, ruleset: Ruleset, rng: Rng): Roll {
  const { count } = diceToRoll(rating, ruleset.dice);
  const dice = Array.from({ length: count }, () => rng.roll(ruleset.dice.sides));
  const { kept, total, result } = readDice(dice, rating, ruleset.dice);
  return { stat, rating, difficulty: 0, modifiers: [], points: rating, method: ruleset.dice.method,
    sides: ruleset.dice.sides, dice, kept, total, result, effectModifiers: [], effect: null };
}

export function resistanceReduction(result: RollResult, ruleset: Ruleset): number {
  const r = ruleset.resistance.reduction[result];
  return r === 'negate' ? Infinity : r;
}

// ================================================================ stakes (RUL §4)

type Stakes = { success: PlannedConsequence[]; partial: PlannedConsequence[]; failure: PlannedConsequence[] };
export function selectOutcome(stakes: Stakes, result: RollResult, effect: EffectLevel, ruleset: Ruleset) {
  const costs = result === 'partial' ? stakes.partial : result === 'failure' ? stakes.failure : [];
  const finalEffect = shiftEffect(effect, -costs.filter((c) => c.type === 'reduced-effect').length);
  const scale = ruleset.effect.scaling[finalEffect];
  const fatal = ruleset.harm.levels.length + 1;
  const achieved = result === 'failure' ? [] : stakes.success.map((c): PlannedConsequence => {
    const out: PlannedConsequence = { ...c };
    if (c.harm) out.harm = { ...c.harm, level: Math.max(1, Math.min(fatal, c.harm.level + scale.harmLevels)) };
    if (c.clockTicks) out.clockTicks = { ...c.clockTicks, ticks: Math.max(1, c.clockTicks.ticks + scale.clockTicks) };
    return out;
  });
  return { effect: finalEffect, consequences: [...achieved, ...costs], treatmentLevels: scale.treatmentLevels };
}

// ================================================================ placement (RUL §6.5)

export type Lethality = 'lethal' | 'heroic' | 'none';
export function placeHarm(statuses: Status[], level: number, ruleset: Ruleset, lethality: Lethality):
  { placedLevel: HarmLevel | null; outcome: 'negated' | 'placed' | 'fatal' | 'survived-fatal' | 'capped' } {
  const top = ruleset.harm.levels.length; // highest non-fatal level
  if (level <= 0) return { placedLevel: null, outcome: 'negated' };
  let l = Math.min(level, top + 1);
  if (ruleset.harm.overflow === 'up') {
    const full = (lv: number) => {
      const cap = ruleset.harm.levels[lv - 1]?.capacity;
      return cap !== null && cap !== undefined &&
        statuses.filter((s) => s.kind === 'harm' && !s.permanent && s.level === lv).length >= cap;
    };
    while (l <= top && full(l)) l++;
  }
  if (l <= top) return { placedLevel: l, outcome: 'placed' };
  if (lethality === 'lethal') return { placedLevel: top + 1, outcome: 'fatal' };
  return { placedLevel: top, outcome: lethality === 'heroic' ? 'survived-fatal' : 'capped' };
}

// ================================================================ healing (RUL §6.6)

export function heal(statuses: Status[], now: number, ruleset: Ruleset) {
  const changes: { status: Status; toLevel: HarmLevel | null; changedAt: number }[] = [];
  for (const s of statuses) {
    if (s.kind !== 'harm' || s.permanent || s.level === undefined) continue;
    let level = s.level; let at = s.changedAt;
    for (;;) {
      const def = ruleset.harm.levels[level - 1];
      if (!def) break; // fatal level does not heal
      const interval = s.treated ? def.treatedHealMinutes : def.untreatedHealMinutes;
      if (interval === null || now - at < interval) break;
      at += interval; level -= 1;
      if (level === 0) break;
    }
    if (level !== s.level) changes.push({ status: s, toLevel: level === 0 ? null : level, changedAt: at });
  }
  return changes;
}

// ================================================================ clocks (RUL §7)

export function tickClock(filled: number, segments: number, ticks: number) {
  const to = Math.max(0, Math.min(segments, filled + ticks));
  return { from: filled, to, completed: to === segments && filled < segments };
}
