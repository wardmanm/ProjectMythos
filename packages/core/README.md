# @mythos/core

Pure game logic: dice and results, harm, clocks, world-state reducers, commit
validation, calendar math, retrieval scoring, and context budget allocation
([01-architecture.md §2.1](../../spec/01-architecture.md)). It depends on
`@mythos/contracts` only.

## Public API

`@mythos/core`, exported from `src/index.ts` as TypeScript source (ARCH-005).

- **Ordering** (`compare.ts`): `cmp(a, b)` orders strings by code point. Use it for every
  sort that reaches stored data, prompts, or tests, never `localeCompare` or plain `<`
  (CONV-087, ADR-011).
- **Calendars** (`calendar.ts`), for converting game time (minutes since the epoch):
  - `toDate` and `fromDate` convert between game time and dates;
  - `isLeap`, `monthDays`, `dayMinutes`, and `timeOfDay` describe a calendar;
  - `minutesUntil` gives the minutes to the next start of a named time of day;
  - `dateIssues` and `calendarIssues` list what's wrong with a date or a calendar;
  - the `ResolvedDate` type.

  Spec: 12-time-world §2, TIME-001 to TIME-004, TIME-011, and TIME-021.

- **Calendar display** (`calendar-display.ts`): `formatDate` and `formatDuration`, for
  showing time to the player (TIME-010, TIME-012).
- **Themes** (`theme.ts`): `contrast` gives the WCAG contrast ratio. `CONTRAST_RULES` lists
  the pairs every palette must meet, and `themeIssues` lists everything that stops a
  theme being applied (UI-031).

## Rules

Every function is deterministic given its inputs (ARCH-010). Code here never does IO,
never imports a Node built-in, never touches Node globals such as `process`, `fetch`,
or the timers, and never calls `Date.now()`, `new Date()`, or `Math.random()`: time and
randomness are parameters (CONV-060). Lint enforces all of this outside test files.
Tests may use Node, for example to read fixtures, which is why the tsconfig includes
Node's types.

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §2
- [02-conventions.md](../../spec/02-conventions.md) §8
- [12-time-world.md](../../spec/12-time-world.md) §2
- [14-ui.md](../../spec/14-ui.md) §3.2
