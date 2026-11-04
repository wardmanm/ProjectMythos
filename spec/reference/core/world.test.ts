import { readFileSync } from 'node:fs';
import { CalendarDefinitionSchema } from '@mythos/contracts/content';
import { MachineConfigSchema } from '@mythos/contracts';
import { batchActors, planTicks, selectActors, statChangeTicks, type ActorCandidate } from './world';
import { eq, fixturePath } from '../test-support/harness';
const greg = CalendarDefinitionSchema.parse(JSON.parse(readFileSync(fixturePath('library/calendars/calendar.gregorian.json'), 'utf8')));
const lim = { maxFineTicks: 3, maxCoarsePeriods: 5 };
const H = 60, D = 1440, T = 8 * H;
const now = 1000 * D + 18 * H; // 18:00

eq('a 10-minute conversation crosses nothing', planTicks(now, now + 10, T, greg, lim), []);
eq('waiting until after midnight crosses one boundary (00:00)', planTicks(now, now + 7 * H, T, greg, lim).map((p) => [p.end - now, p.coarse]), [[6 * H, false]]);
eq('sleeping until 07:00 (13 h) crosses only midnight', planTicks(now, now + 13 * H, T, greg, lim).length, 1);
eq('sleeping until 09:00 (15 h) crosses midnight and 08:00', planTicks(now, now + 15 * H, T, greg, lim).length, 2);
const week = planTicks(now, now + 7 * D, T, greg, lim);
eq('a week: 21 boundaries go coarse, one period per day... capped to 5: weekly is 1 period', [week.length, week.every((p) => p.coarse)], [1, true]);
const month = planTicks(now, now + 30 * D, T, greg, lim);
eq('a month: 5 weekly periods', [month.length, (month[0]!.end - month[0]!.start) / D], [5, 7]);
const year = planTicks(now, now + 365 * D, T, greg, lim);
eq('a year: 4 seasonal periods', year.length, 4);
const decade = planTicks(now, now + 3650 * D, T, greg, lim);
eq('a decade: at most 5 periods, beyond the ladder', decade.length <= 5, true);
for (const [name, plan] of [['week', week], ['month', month], ['year', year], ['decade', decade]] as const) {
  const contiguous = plan.every((p, i) => i === 0 || p.start === plan[i - 1]!.end);
  const aligned = plan.every((p) => p.start % T === 0 && p.end % T === 0);
  eq(`${name}: periods are contiguous and on tick boundaries`, [contiguous, aligned], [true, true]);
}
eq('coarse periods cover exactly the boundaries crossed', [month[0]!.start, month[month.length - 1]!.end], [Math.floor(now / T) * T, Math.floor((now + 30 * D) / T) * T]);

const c = (id: string, extra: Partial<ActorCandidate>): ActorCandidate => ({ id, kind: 'npc', locationId: 'place.harbor', hasGoals: false, ownsRunningClock: false, recentWithPc: false, keyNpc: false, onScreen: false, ...extra });
const cands = [
  c('npc.varek', { hasGoals: true, ownsRunningClock: true, locationId: 'place.harbor-office' }),
  c('npc.odette', { recentWithPc: true, locationId: 'place.gull-and-anchor' }),
  c('npc.tomas', { hasGoals: true }),
  c('npc.fishwife', {}),
  c('npc.bartender', { recentWithPc: true, onScreen: true, locationId: 'place.gull-and-anchor' }),
  c('faction.tide-wardens', { kind: 'faction', hasGoals: true, locationId: null }),
];
eq('active actors by priority; idle and on-screen NPCs never', selectActors(cands, 8).map((a) => a.id), ['npc.varek', 'faction.tide-wardens', 'npc.tomas', 'npc.odette']);
eq('cap respected', selectActors(cands, 2).map((a) => a.id), ['npc.varek', 'faction.tide-wardens']);
eq('batches keep co-located actors together', batchActors(selectActors(cands, 8), 2).map((b) => b.map((a) => a.id)),
  [['npc.odette', 'npc.tomas'], ['npc.varek', 'faction.tide-wardens']]);

eq('stat change pace: an afternoon earns nothing, a week 1, a month 4, two months 9', [4 * H, 7 * D, 30 * D, 60 * D].map((m) => statChangeTicks(m, greg, 1)), [0, 1, 4, 9]);
const mc = MachineConfigSchema.parse(JSON.parse(readFileSync(fixturePath('test/machine-config.json'), 'utf8')));
eq('world defaults', mc.world, { enabled: true, maxFineTicks: 3, maxCoarsePeriods: 5, maxActorsPerTick: 8, actorsPerCall: 4, recentInvolvementDays: 7 });
