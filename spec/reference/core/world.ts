import { cmp } from './compare';
import type { CalendarDefinition } from '@mythos/contracts/content';
import { dayMinutes } from './calendar';

// ================================================================ planning ticks (TIME §5.2)

export type TickPeriod = { start: number; end: number; coarse: boolean };
export type TickLimits = { maxFineTicks: number; maxCoarsePeriods: number };

/**
 * The periods to simulate when game time advances from `t0` to `t1`. Boundaries fall at
 * whole multiples of `tickMinutes` from the epoch. Few boundaries → one fine tick each;
 * many → at most `maxCoarsePeriods` coarse periods, sized from a calendar ladder.
 */
export function planTicks(t0: number, t1: number, tickMinutes: number, c: CalendarDefinition, lim: TickLimits): TickPeriod[] {
  const first = Math.floor(t0 / tickMinutes) + 1, last = Math.floor(t1 / tickMinutes);
  const crossed = last - first + 1;
  if (crossed <= 0) return [];
  if (crossed <= lim.maxFineTicks)
    return Array.from({ length: crossed }, (_, i) => ({ start: (first + i - 1) * tickMinutes, end: (first + i) * tickMinutes, coarse: false }));
  const start = (first - 1) * tickMinutes, end = last * tickMinutes, span = end - start;
  const day = dayMinutes(c);
  const regularMonths = c.months.filter((m) => !m.intercalary && m.days > 0);
  const year = c.months.reduce((a, m) => a + m.days, 0) * day;
  const ladder = [day, (c.weekdays.length || 7) * day, (year / Math.max(1, regularMonths.length)), year / 4, year]
    .map((s) => Math.max(tickMinutes, Math.round(s / tickMinutes) * tickMinutes)); // whole ticks only
  const size = ladder.find((s) => Math.ceil(span / s) <= lim.maxCoarsePeriods)
    ?? Math.ceil(span / lim.maxCoarsePeriods / tickMinutes) * tickMinutes;
  const out: TickPeriod[] = [];
  for (let s = start; s < end; s += size) out.push({ start: s, end: Math.min(end, s + size), coarse: true });
  return out;
}

// ================================================================ actors (TIME §5.3)

export type ActorCandidate = {
  id: string;
  kind: 'npc' | 'faction';
  locationId: string | null;
  hasGoals: boolean;
  ownsRunningClock: boolean;
  recentWithPc: boolean; // shared an observation with the PC within recentInvolvementDays
  keyNpc: boolean;
  onScreen: boolean; // at the PC's place during an ordinary (non-skip) advance
};

export function selectActors(cands: ActorCandidate[], max: number): ActorCandidate[] {
  const active = cands.filter((c) => !c.onScreen && (c.hasGoals || c.ownsRunningClock || c.recentWithPc));
  const score = (c: ActorCandidate) => (c.ownsRunningClock ? 4 : 0) + (c.hasGoals ? 3 : 0) + (c.recentWithPc ? 2 : 0) + (c.keyNpc ? 1 : 0);
  return active.sort((a, b) => score(b) - score(a) || cmp(a.id, b.id)).slice(0, max);
}

/** Groups actors into calls, keeping actors in the same place together where possible. */
export function batchActors(actors: ActorCandidate[], perCall: number): ActorCandidate[][] {
  const byPlace = [...actors].sort((a, b) => (a.locationId === null ? 1 : 0) - (b.locationId === null ? 1 : 0) || cmp(a.locationId ?? '', b.locationId ?? '') || cmp(a.id, b.id));
  const out: ActorCandidate[][] = [];
  for (let i = 0; i < byPlace.length; i += perCall) out.push(byPlace.slice(i, i + perCall));
  return out;
}

// ================================================================ stat change pace (TIME §6)

/** Ticks earned by `elapsedMinutes` of sustained effort: round(elapsed weeks × ticksPerWeek). */
export function statChangeTicks(elapsedMinutes: number, c: CalendarDefinition, ticksPerWeek: number): number {
  return Math.round((elapsedMinutes / (7 * dayMinutes(c))) * ticksPerWeek);
}

// ================================================================ world tick → commits (TIME §5.5)

import type { Clock, CommitPayload, WorldTick } from '@mythos/contracts';
import type { SemanticIssue } from '@mythos/contracts';
import { extractionToCommits, type ExtractionContext } from './memory';

export type WorldTickContext = ExtractionContext & {
  period: TickPeriod;
  actorIds: string[];
  isSkip: boolean; // the advance was at least the setting's sceneBreakMinutes (TIME-030)
  clocks: Record<string, Clock>;
  calendar: CalendarDefinition;
  isClaim(observationId: string): boolean; // for '#n' rumor handles
};

export function worldTickToCommits(x: WorldTick, ctx: WorldTickContext): { commits: CommitPayload[]; issues: SemanticIssue[] } {
  const day = dayMinutes(ctx.calendar);
  const { start, end, coarse } = ctx.period;
  const timeOf = (i: number) => {
    const o = x.observations[i];
    return coarse && o ? Math.min(end, start + (o.day - 1) * day + Math.floor(day / 2)) : end;
  };
  const shared = extractionToCommits({ ...x, observations: x.observations.map(({ day: _d, ...o }) => o) }, ctx,
    { mode: 'world-tick', pcMayWitness: ctx.isSkip, observationTime: timeOf });
  const issues = [...shared.issues];
  const issue = (path: string, message: string) => issues.push({ path, message });
  const commits: CommitPayload[] = [
    { type: 'tick.record', periodStart: start, periodEnd: end, coarse, actorIds: ctx.actorIds, summary: x.summary },
    ...shared.commits,
  ];
  const created = new Map(shared.commits.flatMap((c) => (c.type === 'entity.create' ? [[c.entity.id, c.entity] as const] : [])));
  const known = (id: string) => (ctx.entities[id] || created.get(id) ? id : null);
  const newIds = new Map<string, string>(); // new.<slug> → id, rebuilt from creation order
  x.newEntities.forEach((n, i) => { const c = shared.commits.filter((k) => k.type === 'entity.create')[i]; if (c?.type === 'entity.create') newIds.set(n.ref, c.entity.id); });
  const ref = (r: string, path: string) => { const id = r.startsWith('new.') ? newIds.get(r) ?? null : known(r); if (!id) issue(path, `${r} does not exist`); return id; };
  const obsIds = shared.commits.flatMap((c) => (c.type === 'observation.add' ? [c.observation] : []));
  const isCharacter = (id: string) => { const e = ctx.entities[id] ?? created.get(id); return e?.kind === 'npc' || e?.kind === 'pc'; };

  // Clocks: only those owned by this call's actors, or unowned (TIME-074).
  x.clockChanges.forEach((c, i) => {
    const clock = ctx.clocks[c.clockId];
    if (!clock) issue(`clockChanges[${i}].clockId`, `${c.clockId} does not exist`);
    else if (clock.ownerId && !ctx.actorIds.includes(clock.ownerId)) issue(`clockChanges[${i}].clockId`, `${c.clockId} belongs to ${clock.ownerId}, who is not acting in this period`);
  });
  // Rumors: a claim reaching characters secondhand (MEM-035).
  x.rumors.forEach((r, i) => {
    const p = `rumors[${i}]`;
    let claimId: string | null = null;
    if (r.claim.startsWith('#')) {
      claimId = ctx.handles[r.claim] ?? null;
      if (!claimId) issue(`${p}.claim`, `${r.claim} does not refer to an observation`);
      else if (!ctx.isClaim(claimId)) issue(`${p}.claim`, `${r.claim} is not a claim; only claims spread as rumor`);
    } else {
      const idx = x.observations.findIndex((o) => o.ref === r.claim);
      const o = x.observations[idx];
      if (!o) issue(`${p}.claim`, `${r.claim} does not refer to an observation`);
      else if (o.kind !== 'claim') issue(`${p}.claim`, `${r.claim} is not a claim; only claims spread as rumor`);
      else claimId = obsIds[idx]?.id ?? null;
    }
    r.reachedIds.forEach((id, j) => {
      const who = ref(id, `${p}.reachedIds[${j}]`);
      if (!who || !claimId) return;
      if (!isCharacter(who)) { issue(`${p}.reachedIds[${j}]`, `${who} is not a character`); return; }
      if (who === ctx.pcId && !ctx.isSkip) { issue(`${p}.reachedIds[${j}]`, 'the PC can receive news off-screen only during a time skip'); return; }
      commits.push({ type: 'knowledge.grant', grant: { entityId: who, observationId: claimId, via: 'rumor', viaObservationId: null, gameTime: end } });
    });
  });
  x.goalUpdates.forEach((g, i) => {
    const who = ref(g.characterId, `goalUpdates[${i}].characterId`);
    if (who === ctx.pcId) issue(`goalUpdates[${i}].characterId`, 'the PC\'s goals are the player\'s');
    else if (who) commits.push({ type: 'entity.update-narrative', entityId: who, fields: { goals: g.goals } });
  });
  x.deaths.forEach((d, i) => {
    const who = ref(d.characterId, `deaths[${i}].characterId`);
    if (!who) return;
    if (who === ctx.pcId) issue(`deaths[${i}].characterId`, 'the PC never dies off-screen');
    else if (!isCharacter(who)) issue(`deaths[${i}].characterId`, `${who} is not a character`);
    else if (ctx.ruleset.lethality.npc !== 'lethal') issue(`deaths[${i}]`, 'NPCs cannot die in this campaign (lethality)');
    else commits.push({ type: 'entity.death', characterId: who, cause: d.cause });
  });
  return { commits, issues };
}
