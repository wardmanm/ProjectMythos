import { readFileSync } from 'node:fs';
import { randomUUID as u } from 'node:crypto';
import { RulesetSchema, type Ruleset } from '@mythos/contracts/content';
import type { PlannedConsequence, Status } from '@mythos/contracts';
import { actionRoll, heal, harmPenalties, odds, placeHarm, readDice, resistanceReduction, resistanceRoll, selectOutcome, tickClock, type Rng } from './rules';
import { rulesetIssues } from './ruleset-check';
import { eq, near, fixturePath } from '../test-support/harness';

const dice = (...d: number[]): Rng => { let i = 0; return { roll: () => d[i++] ?? 1 }; };
const load = (f: string): Ruleset => RulesetSchema.parse(JSON.parse(readFileSync(fixturePath(`library/rulesets/${f}`), 'utf8')));
const std = load('ruleset.standard.json'), two = load('ruleset.two-dice.json'), d20 = load('ruleset.d20.json'), d10 = load('ruleset.d10-pool.json');
for (const [n, r] of [['standard', std], ['two-dice', two], ['d20', d20], ['d10-pool', d10]] as const) eq(`${n}: no ruleset issues`, rulesetIssues(r), []);

const harm = (name: string, level: number, tags = ['physical'], extra: Partial<Status> = {}): Status =>
  ({ id: u(), name, kind: 'harm', level, tags, permanent: false, treated: false, inflictedAt: 0, changedAt: 0, ...extra });

// ---------------- standard ruleset: parity with the previous fixed rules
for (let p = -3; p <= 10; p++) { const o = odds(p, std.dice); near(`std odds sum ${p}`, o.critical + o.success + o.partial + o.failure, 1); }
near('std pool 1 success 1/6', odds(1, std.dice).success, 1 / 6);
near('std pool 2 crit 1/36', odds(2, std.dice).critical, 1 / 36);
near('std pool 2 partial 16/36', odds(2, std.dice).partial, 16 / 36);
near('std pool 0 success 1/36', odds(0, std.dice).success, 1 / 36);
near('std pool 0 failure 27/36', odds(0, std.dice).failure, 27 / 36);
eq('std pool 0 no crit', odds(0, std.dice).critical, 0);
eq('std empty pool [6,6] keeps one 6: success', readDice([6, 6], 0, std.dice).result, 'success');
eq('std two sixes: critical', readDice([6, 2, 6], 3, std.dice).result, 'critical');
const roll = (stat: string, rating: number, difficulty: number, rng: Rng, statuses: Status[] = [], itemBonuses: { source: 'item'; label: string; value: number }[] = [], r: Ruleset = std) =>
  actionRoll({ stat, rating, difficulty, itemBonuses, statuses, effectModifier: 0, ruleset: r, rng });
const child = roll('str', 3, 2, dice(2, 3, 5, 1, 4));
eq('arm wrestle child: 5 dice, partial', [child.points, child.dice.length, child.result], [5, 5, 'partial']);
const pro = roll('str', 3, -2, dice(4));
eq('arm wrestle pro: 1 die, partial', [pro.points, pro.dice.length, pro.result], [1, 1, 'partial']);
const hp = harmPenalties([harm('Cracked Ribs', 2), harm('Bruised', 1), harm('Shaken', 1, ['mental'])], 'str', std);
eq('moderate physical: -1 point on STR', hp.points.map((m) => m.value), [-1]);
eq('lesser physical: -1 effect once', hp.effect.map((m) => m.value), [-1]);
const hurt = roll('str', 3, -1, dice(5, 1), [harm('Cracked Ribs', 2), harm('Broken Arm', 3)]);
eq('heavy harm empties pool: roll 2 keep lowest', [hurt.points, hurt.dice.length, hurt.kept, hurt.result], [-1, 2, [1], 'failure']);
const hook = roll('dex', 2, 0, dice(1, 1, 1, 6), [], [{ source: 'item', label: 'Grappling hook', value: 2 }, { source: 'item', label: 'Gloves', value: 1 }]);
eq('item bonus capped at maxRollBonus', [hook.points, hook.modifiers.map((m) => m.value)], [4, [2]]);
eq('INT 1 success: limited', [roll('int', 1, 1, dice(6, 3)).result, roll('int', 1, 1, dice(6, 3)).effect], ['success', 'limited']);
const int5 = roll('int', 5, 0, dice(5, 2, 1, 3, 4));
eq('INT 5 partial: great before costs', [int5.result, int5.effect], ['partial', 'great']);
const stakes = {
  success: [{ type: 'progress', targetId: 'pc.wren', description: 'Pump works', clockTicks: { clockId: 'clock.hold', ticks: 2 } }],
  partial: [{ type: 'reduced-effect', targetId: 'pc.wren', description: 'Leaks' }],
  failure: [{ type: 'complication', targetId: 'pc.wren', description: 'Jams' }],
} as { success: PlannedConsequence[]; partial: PlannedConsequence[]; failure: PlannedConsequence[] };
const sel = selectOutcome(stakes, 'partial', 'great', std);
eq('INT 5 partial + reduced effect: standard, 2 ticks', [sel.effect, sel.consequences[0]?.clockTicks?.ticks], ['standard', 2]);
eq('limited: 1 tick', selectOutcome(stakes, 'success', 'limited', std).consequences[0]?.clockTicks?.ticks, 1);
const res = resistanceRoll('end', 2, std, dice(5, 2));
eq('stabbing: END 2 resists severe to moderate', [res.result, 3 - resistanceReduction(res.result, std), placeHarm([], 2, std, 'heroic')], ['partial', 2, { placedLevel: 2, outcome: 'placed' }]);
eq('resistance roll has no effect', res.effect, null);
eq('critical resistance negates', resistanceReduction('critical', std), Infinity);
eq('overflow up', placeHarm([harm('a', 1), harm('b', 1)], 1, std, 'lethal').placedLevel, 2);
eq('all full: fatal', placeHarm([harm('a', 1), harm('b', 1), harm('c', 2), harm('d', 2), harm('e', 3)], 1, std, 'lethal'), { placedLevel: 4, outcome: 'fatal' });
eq('heroic survives', placeHarm([harm('e', 3)], 3, std, 'heroic'), { placedLevel: 3, outcome: 'survived-fatal' });
eq('none caps', placeHarm([], 4, std, 'none'), { placedLevel: 3, outcome: 'capped' });
const day = 1440, week = 10080;
eq('lesser heals in a day', heal([harm('Bruised', 1)], day, std).map((c) => c.toLevel), [null]);
eq('moderate: week then day', [heal([harm('Cut', 2)], week, std).map((c) => c.toLevel), heal([harm('Cut', 2)], week + day, std).map((c) => c.toLevel)], [[1], [null]]);
eq('severe untreated never heals', heal([harm('Gut', 3)], week * 10, std), []);
eq('severe treated: moderate in a week', heal([harm('Gut', 3, ['physical'], { treated: true })], week, std).map((c) => c.toLevel), [2]);
eq('clock completes once', [tickClock(5, 6, 2).completed, tickClock(6, 6, 1).completed], [true, false]);

// ---------------- two dice (2d6 + stat)
for (let p = -3; p <= 5; p++) { const o = odds(p, two.dice); near(`2d6 odds sum ${p}`, o.critical + o.success + o.partial + o.failure, 1); }
near('2d6+0 strong hit 6/36', odds(0, two.dice).success, 6 / 36);
near('2d6+0 weak hit 15/36', odds(0, two.dice).partial, 15 / 36);
near('2d6+2 miss 6/36', odds(2, two.dice).failure, 6 / 36);
const t = actionRoll({ stat: 'heart', rating: 2, difficulty: 0, itemBonuses: [], statuses: [], effectModifier: 0, ruleset: two, rng: dice(4, 3) });
eq('2d6+2 rolling 4,3: total 9, weak hit, always 2 dice', [t.dice.length, t.total, t.result], [2, 9, 'partial']);
const negative = actionRoll({ stat: 'wits', rating: -1, difficulty: 0, itemBonuses: [], statuses: [], effectModifier: 0, ruleset: two, rng: dice(6, 5) });
eq('2d6 with a -1 stat: 11 - 1 = 10 strong hit', [negative.total, negative.result], [10, 'success']);
eq('2d6 badly hurt: -1 to total', actionRoll({ stat: 'grit', rating: 1, difficulty: 0, itemBonuses: [], statuses: [harm('Shot', 2, ['harm'])], effectModifier: 0, ruleset: two, rng: dice(3, 4) }).total, 7);
eq('2d6: dying at level 3', placeHarm([harm('a', 2), harm('b', 2)], 2, two, 'lethal'), { placedLevel: 3, outcome: 'fatal' });

// ---------------- d20 + stat, natural 20
near('d20+3: crit 1/20', odds(3, d20.dice).critical, 1 / 20);
near('d20+3: success 8/20 (12-19)', odds(3, d20.dice).success, 8 / 20);
near('d20+3: partial 5/20 (7-11)', odds(3, d20.dice).partial, 5 / 20);
near('d20+3: failure 6/20', odds(3, d20.dice).failure, 6 / 20);
eq('natural 20 is critical even if total is low', readDice([20], -10, d20.dice).result, 'critical');

// ---------------- d10 pool counting 8+
near('d10x3: failure 0.343', odds(3, d10.dice).failure, 0.343);
near('d10x3: partial 0.441', odds(3, d10.dice).partial, 0.441);
near('d10x3: success 0.216', odds(3, d10.dice).success, 0.216);
near('d10x4: critical 0.0081', odds(4, d10.dice).critical, 0.3 ** 4);
near('d10 empty pool: one die, highest kept, 30% partial', odds(0, d10.dice).partial, 0.3);

// ---------------- broken rulesets are caught
const broken = RulesetSchema.parse({ ...JSON.parse(readFileSync(fixturePath('library/rulesets/ruleset.standard.json'), 'utf8')),
  effect: { ...std.effect, byRating: ['limited', 'great', 'standard'] } });
const issues = rulesetIssues({ ...broken, harm: { ...broken.harm, tags: [{ ...broken.harm.tags[0]!, resistStat: 'luck' }] } });
eq('broken ruleset: every problem reported', issues.length, 3);
