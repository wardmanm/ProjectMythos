---
doc: 12-time-world
title: Mythos — Time and the World
status: draft
schemaVersion: 1
requirementPrefix: TIME
---

# Time and the World

> **For Claude:** this document owns the `world` server module and the calendar and world
> logic in `packages/core`. `world-tick.ts` belongs in `packages/contracts/src/`. The
> calendar math was checked against Python's `datetime` on 518 dates from 1870 to 2600,
> and against the fantasy calendar fixture; tick planning, actor selection, and world
> tick conversion were validated with a reference implementation.

Time in Mythos is a single number, and the world keeps moving when the PC isn't
looking. This document covers the calendar, how time advances, scenes, time skips, and
**world ticks**: the off-screen simulation in which NPCs pursue their goals, move
around, and pass on what they know.

## 1. Principles

- **One clock.** Game time is integer minutes since the campaign epoch (CON-012). The
  calendar only converts it for display and input; all logic uses minutes.
- **Only the GM moves time.** During play, time advances only through a ruling's
  `elapsedMinutes` (TRN-032), a skip command (§4), or a player edit.
- **The world doesn't wait.** When time passes, active NPCs act off-screen. What they do
  becomes memory like anything else, so news can travel, rumors can distort, and a
  character the PC left in the harbor may not be there next week.
- **Bounded cost.** A ten-year skip costs about as many model calls as a one-week skip.

## 2. Calendars

A calendar definition (`04-content-schemas.md` §4) describes months, intercalary days
(festivals outside any month), leap rules, weekdays, hours per day, and times of day.
The setting picks a calendar and an **epoch**, the date at game time 0.

- **TIME-001** Conversion between game time and calendar dates is exact and pure:
  `toDate`, `fromDate`, `formatDate` in `core`. Every valid date round-trips.
- **TIME-002** A month with `days: 0` and `leapDays: 1` is a festival that exists only in
  leap years. In other years it is skipped entirely: the day after the preceding
  festival is the first day of the next month.
- **TIME-003** With `weekdaysSkipIntercalary`, intercalary days have no weekday and do
  not advance the week: the day after a festival continues the cycle where it left off.
  The setting's `epochWeekday` is the weekday of the epoch, which must then be a
  regular day.
- **TIME-004** `calendarIssues` reports every problem a schema cannot express (SCH-030 to
  SCH-032): a 0-day month that isn't an intercalary leap day; `leapDays` without a leap
  rule; no regular months; times of day not starting at 0 or out of order; unknown
  format tokens. A calendar with issues cannot be used.

### 2.1 Display

- **TIME-010** `format` and `intercalaryFormat` use the tokens `{weekday} {day} {month}
  {monthNumber} {year} {era} {hour} {minute} {timeOfDay}`; hour and minute are
  zero-padded. Empty tokens collapse their spaces. *"Monday, October 12, 1874
  (evening)"*; *"Deepwinter, 1 LC (midday)"*.
- **TIME-011** The **time of day** is the last entry in `timesOfDay` whose `startHour`
  is at or before the current hour. It is used in display, narration, and skips.
- **TIME-012** Durations are shown in the two largest units, using the calendar's day
  and week lengths: *"3 days, 4 hours"*, *"4 weeks, 2 days"*.

### 2.2 Example: a fantasy calendar

The fixture `spec/fixtures/test/calendars/calendar.long-count.json` is an invented calendar
used by tests: twelve 30-day months, five one-day festivals, a leap-year-only festival
(*Leapnight*), and a six-day week that skips festivals. Real-world calendars
(Gregorian) and published-setting calendars are authored the same way;
`calendar.gregorian` ships in the built-in library, and published settings' calendars
are left for players to author in their user library.

## 3. Advancing time

- **TIME-020** Every ruling states `elapsedMinutes` (TRN-032), and the resolution set
  records it as `time.advance`. Healing (RUL-111), world-tick scheduling (§5), and scene
  breaks (§3.1) all follow from that one commit.
- **TIME-021** To make durations easy to judge, the adjudicator's scene tier includes
  the current date and time of day, and a **time-until table**: minutes until the next
  start of each time of day (*"dawn +660, morning +780, …"*), computed by the engine.
  "Wait until morning" never requires the model to do date math.
- **TIME-022** The adjudication template gives duration guidance: an exchange of words,
  1–5 minutes; searching a room, 10–30; a meal, 30–60; a night's sleep, until dawn or
  morning; travel, by distance and means. Pack authors MAY add setting-specific travel
  times in the pack's adjudicator template partial.

### 3.1 Scenes

- **TIME-030** A single time advance of at least the setting's `sceneBreakMinutes`
  (default 240) is a **time skip**. It starts a new scene at the PC's place: the
  resolution set adds `scene.start` after `time.advance`.
- **TIME-031** A scene also starts when the PC moves to another place (MEM-054). Each new
  scene triggers the previous scene's transcript summary (CTX-042).

## 4. Time skips

A skip is any advance of at least `sceneBreakMinutes`: sleeping, a long journey, "a
month passes". Players can skip three ways:

| How | Example | Ruling |
|---|---|---|
| In character | "I spend the next month training with the harbor guard." | Adjudicated normally |
| Out of character | "Skip to morning." | An `ooc` ruling with `elapsedMinutes` |
| Skip control | The UI's *Skip time* button: until a time of day, a duration, or a date | Built by the engine (TIME-040) |

- **TIME-040** `SkipTimeCommand` creates a turn whose input records the skip ("Skip until
  morning"). Without an activity, the engine writes the adjudication set itself (origin
  `engine`): an `ooc` ruling with the computed `elapsedMinutes` and an empty reply, so no
  model is needed for the ruling. With an activity, the turn's input is the activity
  ("I spend the time until morning training with the harbor guard") and it is
  adjudicated normally, except the engine replaces the ruling's `elapsedMinutes` with the
  computed duration, which the prompt also states.
- **TIME-041** Computing the duration: `time-of-day` is the next start of that time of
  day (strictly in the future); `duration` is as given; `date` must be in the future and
  valid on the calendar (SCH-031), else `validation_failed`.
- **TIME-042** A skip's narration describes the passage of time and the PC's own
  activity. The narrator is told not to invent other characters' actions during the
  skip: off-screen events are simulated afterward (§5) and shown to the player (§7).

## 5. World ticks

### 5.1 When ticks happen

- **TIME-050** **Tick boundaries** fall at whole multiples of the setting's
  `worldTickMinutes` (default 480: 00:00, 08:00, 16:00) from the epoch. A turn whose time
  advance crosses one or more boundaries schedules world ticks for the periods it
  crossed.
- **TIME-051** World ticks run **after the turn's extraction**, in the turn's
  `world-tick` stage, so they see everything that happened on-screen. The turn's status
  is `world-ticking` while they run. Ticks run even if extraction failed.
- **TIME-052** The next action waits for the turn's world ticks as well as its extraction
  (ARCH-070). For ordinary turns this is rare (once per eight game hours by default); for
  skips the client shows progress (one step per period and batch).
- **TIME-053** Ticks within a turn run in order. Each reads at the point after the turn's
  extraction plus the turn's earlier world-tick sets (`ReadPoint.worldTicksBefore`), so
  each period builds on the last.
- **TIME-054** Each tick (one period, one batch of actors) produces one world-tick set
  (sets of this stage accumulate, CON-082), beginning with a `tick.record` commit: the
  period, whether it was coarse, the actors, and a one-paragraph summary. The set's
  `basedOnSetIds` are the turn's resolution and extraction sets.

### 5.2 Planning periods

- **TIME-055** If the boundaries crossed number at most `world.maxFineTicks` (machine
  config, default 3), each becomes one **fine** period ending at that boundary.
- **TIME-056** Otherwise the whole span is divided into at most `world.maxCoarsePeriods`
  (default 5) **coarse** periods of equal size, the smallest from the ladder *day, week,
  month, season, year* (from the calendar's lengths, rounded to whole ticks) that fits;
  beyond a year, the span divided evenly. Periods are contiguous and start and end on
  tick boundaries.

| Advance | Boundaries | Periods |
|---|---|---|
| 10 minutes | 0 | none |
| 18:00 → 07:00 (sleep) | 1 | 1 fine |
| 18:00 → 09:00 | 2 | 2 fine |
| A week | 21 | 1 coarse (a week) |
| A month | 90 | 5 coarse (weeks) |
| A year | 1,095 | 4 coarse (seasons) |
| Ten years | 10,950 | 5 coarse (two years each) |

### 5.3 Actors

- **TIME-060** An **actor** is a living NPC, or a faction, that is active: it has goals
  (SCH-081), owns a clock that isn't complete, or (NPCs) shared an observation with the
  PC within `world.recentInvolvementDays` (default 7). The PC is never an actor.
- **TIME-061** During an ordinary advance (not a skip), NPCs at the PC's place are
  on-screen and are not actors. During a skip, they are.
- **TIME-062** Actors are ranked (running clock 4, goals 3, recent involvement 2, key NPC
  1; ties by ID) and capped at `world.maxActorsPerTick` (default 8). The same actors are
  used for every period of a turn's ticks, so a skip's simulation stays coherent.
- **TIME-063** Actors are split into calls of at most `world.actorsPerCall` (default 4),
  sorted by location so characters in the same place share a call and can meet.
- **TIME-064** Calls per turn = periods × batches: at most 5 × 2 = 10 with defaults. On
  slow hardware the player lowers these limits; with `world.enabled: false`, no ticks
  run (time still passes, and healing still applies).

### 5.4 The world-ticker prompt

The `world-ticker` role, with `world-ticker.md` (CTX-074):

| Tier | Contains |
|---|---|
| instructions | Simulate plausible, modest steps toward each actor's goals, in character; each actor acts only on their own knowledge; big developments only when a clock completes; claims are how news travels; tone and content settings |
| world | Setting summary |
| scene | The period (dates, length, coarse or fine); each actor's place, with the public blocks of everyone at those places; nearby places; the PC's place and public block |
| state | Each actor's statuses, goals, and owned clocks; faction clocks |
| knowledge | Each actor's knowledge block (CTX-050): relationships, wiki sections, and recent and important memories, including claims they could pass on, with handles (`#n`) |
| turn | During a skip: what the PC is doing, from the skip's ruling |
| task | Produce a `WorldTick` |

### 5.5 Output and validation

The output (§9) extends extraction's (`08-memory.md` §4.2): every observation names its
`placeId` and the `day` of the period it happened on, and the output adds a `summary`,
`rumors`, `goalUpdates`, and `deaths`. Status and clock changes are always allowed.

- **TIME-070** Conversion follows MEM §4.4, plus: observations in a coarse period are
  timed at noon on their day; in a fine period, at its end. Grants and rumors are timed
  likewise.
- **TIME-071** **Witnesses** must be at the observation's place: there at the start of
  the period, arriving in this output, or introduced there (MEM-011). Nobody witnesses an
  event across town.
- **TIME-072** **The PC off-screen.** The PC never acts, speaks, moves, changes feelings
  or goals, or dies in a world tick. During a skip only, the PC may witness events at
  their own place (Odette visits) and receive claims and rumors (a letter, gossip at the
  inn). Outside a skip the PC is on-screen, and anything involving them is narrated, not
  simulated.
- **TIME-073** **Rumors** grant a claim to characters `via: 'rumor'`: they heard it
  secondhand. Only claims spread. A retelling that changes the content is a new claim
  observation from the reteller (`truthful` judged against the truth), not a rumor.
  Rumors read as hearsay: *"Word has it that the stranger's brother drowned in the
  squall (the story started with Varek)."*
- **TIME-074** **Clocks** may be ticked only if unowned or owned by an actor in this call.
- **TIME-075** **Deaths** follow the ruleset's NPC lethality (CON-086); under `heroic` or
  `none` an NPC death is a semantic issue, and the model should write lasting harm
  instead.
- **TIME-076** Every issue is fed back for a retry (PRV-050). A tick that still fails is
  skipped: its periods are listed in GM mode, the turn ends `world-tick-failed`, and the
  player can retry it. Play continues either way.

### 5.6 Regeneration

- **TIME-080** Superseding a turn's resolution deactivates its world-tick sets and plans
  ticks again from the new resolution (TRN-086). Superseding its extraction makes the
  tick sets stale, like any downstream stage (TRN-085).
- **TIME-081** Regenerating a world tick re-runs it and every later tick of that turn.

## 6. Healing and stat change over time

- **TIME-090** Healing is computed whenever time advances (RUL-111), for every living
  character, on-screen or not. A month's skip heals a moderate wound.
- **TIME-091** **Stat change is paced by the engine, not the model.** When a progress
  consequence ticks a stat-change clock, the engine replaces the ruling's tick count
  with `round(elapsed weeks × statChange.ticksPerWeek)` for the action's
  `elapsedMinutes`. The GM decides *whether* the PC put in sustained effort (or
  sustained neglect); the engine decides *how much* it counts. An afternoon's training
  earns nothing; a month earns 4 ticks; two months complete the standard 8-segment clock.
  The draft shows the computed ticks, and the player can override them.

## 7. Off-screen news

- **TIME-100** After a skip's ticks complete, the turn view's `offscreen` lists what the
  PC learned during the skip: observations the PC witnessed and claims and rumors the PC
  received, from the turn's world-tick sets, in order, rendered from the PC's point of
  view. The client shows it as a "While time passed" card under the skip's narration.
- **TIME-101** Everything else that happened off-screen stays hidden. Its summary
  (`tick.record`) and observations are visible in GM mode only.
- **TIME-102** The next turn's prompts include the changed world naturally: who is
  present, what the PC now knows, and NPCs' new memories.

## 8. API

| Method & path | Body | Returns |
|---|---|---|
| `POST /api/campaigns/:campaignId/skip` | `SkipTimeCommand` | `{ turnId }` |
| `GET /api/campaigns/:campaignId/time?turnId=` | — | Date label, time of day, time-until table |
| `GET /api/campaigns/:campaignId/turns/:turnId/ticks` | — | GM mode: each tick's period, actors, summary, and status |
| `POST /api/campaigns/:campaignId/turns/:turnId/ticks/retry` | — | `{ jobId }` |

## 9. Contracts — `world-tick.ts`

```ts
import { z } from 'zod';
import {
  EntityRefSchema,
  ObservationHandleSchema,
  ObservationRefSchema,
  makeExtractionSchemas,
  type ExtractionLimits,
} from './extraction';

/*
 * World tick output (12-time-world §5.5). Model-facing (CON-003, CON-004). It extends the
 * extraction output: every event names its place and day, and ticks may spread rumors,
 * change goals, and kill NPCs. Statuses and clocks are always allowed (world-tick stage).
 */

export type WorldTickLimits = ExtractionLimits & { periodDays: number };

export function makeWorldTickSchemas(limits: WorldTickLimits) {
  const ex = makeExtractionSchemas({ ...limits, narrativeStatuses: true, narrativeClocks: true });
  const observation = ex.observation.extend({
    placeId: EntityRefSchema, // required off-screen: where it happened
    day: z.int().min(1).max(Math.max(1, limits.periodDays)), // day of the period it happened on
  });
  const worldTick = ex.extraction.omit({ observations: true }).extend({
    /** One short paragraph: what happened off-screen this period. Shown in GM mode. */
    summary: z.string().min(1).max(800),
    observations: z.array(observation).max(24),
    /** A claim spreading secondhand: the reached characters learn it as rumor (MEM-035). */
    rumors: z
      .array(
        z.object({
          claim: z.union([ObservationRefSchema, ObservationHandleSchema]),
          reachedIds: z.array(EntityRefSchema).min(1).max(12),
        }),
      )
      .max(8),
    goalUpdates: z
      .array(
        z.object({
          characterId: EntityRefSchema,
          goals: z.array(z.string().min(1).max(200)).max(8), // the full new list
          reason: z.string().min(1).max(300),
        }),
      )
      .max(8),
    deaths: z
      .array(z.object({ characterId: EntityRefSchema, cause: z.string().min(1).max(300) }))
      .max(3),
  });
  return { observation, worldTick };
}

const broad = makeWorldTickSchemas({
  statIds: null,
  rating: { min: -5, max: 20 },
  tagIds: null,
  maxHarmLevel: 9,
  dimensionIds: null,
  maxRelationshipChange: 100,
  narrativeStatuses: true,
  narrativeClocks: true,
  periodDays: 400,
});
export const WorldTickSchema = broad.worldTick;
export type WorldTick = z.infer<typeof WorldTickSchema>;
```

## 10. Phase delivery

| Phase | Scope |
|---|---|
| 1 | Calendar math and display (for turn labels) |
| 3 | Time advance from rulings, time-until table, scene breaks, healing, stat-change pacing |
| 7 | Skip control, world ticks, rumors, off-screen news |

## 11. Required tests

- **TIME-110** Gregorian conversion matches a reference implementation on hundreds of
  dates across leap rules (1900, 2000, 2100), both directions, weekdays included.
- **TIME-111** The fantasy calendar fixture: festivals without weekdays; an unbroken week
  across four years; the leap-only festival only in leap years; every sampled time
  round-trips.
- **TIME-112** Tick planning matches the §5.2 table; periods are contiguous and aligned.
- **TIME-113** Actor ranking, the cap, on-screen exclusion, and location batching.
- **TIME-114** A week-long skip: a claim told at the harbor reaches another NPC as rumor;
  an NPC visits the PC; the clock ticks and the goal changes; all at the right times.
- **TIME-115** Each TIME-072 to TIME-075 violation is reported, all in one pass.
- **TIME-116** Stat-change pacing: an afternoon 0 ticks, a week 1, a month 4.
- **TIME-117** A skip's off-screen news contains exactly what the PC learned during the
  skip, and nothing that only other characters know.
