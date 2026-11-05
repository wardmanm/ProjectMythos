// Calendar math (12-time-world §2). Game time is integer minutes since the campaign
// epoch (CON-012); a calendar only converts it for display and for input. Everything
// here is pure and exact.
import type { CalendarDate, CalendarDefinition } from '@mythos/contracts/content';

/** A game time resolved onto a calendar, for display. */
export type ResolvedDate = {
  year: number;
  /** 1-based index into `calendar.months`, intercalary entries included. */
  month: number;
  /** 1-based. */
  day: number;
  hour: number;
  minute: number;
  /** Index into `calendar.weekdays`, or null on a day outside the week cycle. */
  weekday: number | null;
  intercalary: boolean;
  timeOfDay: string;
};

/** The day part of a date: enough to count days, without the time. */
type DayDate = Pick<CalendarDate, 'year' | 'month' | 'day'>;

/** `a mod b`, never negative, so years before 0 follow the same leap rule. */
function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

/** Minutes in one day of this calendar. */
export function dayMinutes(calendar: CalendarDefinition): number {
  return calendar.hoursPerDay * calendar.minutesPerHour;
}

/** Whether `year` is a leap year under the calendar's leap rule, if it has one. */
export function isLeap(calendar: CalendarDefinition, year: number): boolean {
  const rule = calendar.leapRule;
  if (rule === null) return false;
  if (mod(year, rule.every) !== 0) return false;
  if (rule.exceptEvery !== undefined && mod(year, rule.exceptEvery) === 0) {
    return rule.unlessEvery !== undefined && mod(year, rule.unlessEvery) === 0;
  }
  return true;
}

/**
 * Days in a month in a given year, leap days included. 0 means a leap-only festival in
 * a common year, which is skipped entirely (TIME-002).
 */
export function monthDays(calendar: CalendarDefinition, year: number, month: number): number {
  const entry = calendar.months[month - 1];
  if (entry === undefined) throw new Error(`no month ${String(month)}`);
  return entry.days + (isLeap(calendar, year) ? entry.leapDays : 0);
}

/** Whether a month's days are outside the week cycle (TIME-003). */
function skipsWeekdays(calendar: CalendarDefinition, month: number): boolean {
  return (calendar.months[month - 1]?.intercalary ?? false) && calendar.weekdaysSkipIntercalary;
}

function yearDays(calendar: CalendarDefinition, year: number): number {
  let days = 0;
  for (let month = 1; month <= calendar.months.length; month++) {
    days += monthDays(calendar, year, month);
  }
  return days;
}

/** Days in a year that carry a weekday. */
function yearRegularDays(calendar: CalendarDefinition, year: number): number {
  let days = 0;
  for (let month = 1; month <= calendar.months.length; month++) {
    if (!skipsWeekdays(calendar, month)) days += monthDays(calendar, year, month);
  }
  return days;
}

/**
 * Days from the start of `baseYear` to the date (negative before it), counting all days
 * and, separately, only the days that carry a weekday.
 */
function ordinals(
  calendar: CalendarDefinition,
  date: DayDate,
  baseYear: number,
): { all: number; regular: number } {
  let all = 0;
  let regular = 0;
  for (let year = baseYear; year < date.year; year++) {
    all += yearDays(calendar, year);
    regular += yearRegularDays(calendar, year);
  }
  for (let year = date.year; year < baseYear; year++) {
    all -= yearDays(calendar, year);
    regular -= yearRegularDays(calendar, year);
  }
  for (let month = 1; month < date.month; month++) {
    const days = monthDays(calendar, date.year, month);
    all += days;
    if (!skipsWeekdays(calendar, month)) regular += days;
  }
  return { all: all + date.day - 1, regular: regular + date.day - 1 };
}

/** Every problem with a date on this calendar; empty when the date exists. Implements SCH-031. */
export function dateIssues(calendar: CalendarDefinition, date: CalendarDate): string[] {
  if (date.month < 1 || date.month > calendar.months.length) {
    return [`month ${String(date.month)} does not exist`];
  }
  const issues: string[] = [];
  const name = calendar.months[date.month - 1]?.name ?? '';
  const days = monthDays(calendar, date.year, date.month);
  if (days === 0) {
    issues.push(`${name} only exists in leap years`);
  } else if (date.day > days) {
    issues.push(`${name} ${String(date.year)} has ${String(days)} day${days === 1 ? '' : 's'}`);
  }
  if (date.hour >= calendar.hoursPerDay) issues.push(`hour ${String(date.hour)} does not exist`);
  if (date.minute >= calendar.minutesPerHour) {
    issues.push(`minute ${String(date.minute)} does not exist`);
  }
  return issues;
}

/**
 * The time of day at an hour: the last entry in `timesOfDay` whose `startHour` is at or
 * before it. Implements TIME-011.
 */
export function timeOfDay(calendar: CalendarDefinition, hour: number): string {
  let name = calendar.timesOfDay[0]?.name ?? '';
  for (const entry of calendar.timesOfDay) if (entry.startHour <= hour) name = entry.name;
  return name;
}

/** Game time (minutes since the epoch) of a calendar date. Implements TIME-001. */
export function fromDate(
  calendar: CalendarDefinition,
  epoch: CalendarDate,
  date: CalendarDate,
): number {
  const days = ordinals(calendar, date, epoch.year).all - ordinals(calendar, epoch, epoch.year).all;
  return (
    days * dayMinutes(calendar) +
    (date.hour - epoch.hour) * calendar.minutesPerHour +
    (date.minute - epoch.minute)
  );
}

/**
 * The calendar date of a game time, with its weekday and time of day. `epochWeekday` is
 * the weekday of the epoch (TIME-003). Implements TIME-001.
 */
export function toDate(
  calendar: CalendarDefinition,
  epoch: CalendarDate,
  epochWeekday: number,
  gameTime: number,
): ResolvedDate {
  const perDay = dayMinutes(calendar);
  const sinceEpochDayStart = gameTime + epoch.hour * calendar.minutesPerHour + epoch.minute;
  const dayOffset = Math.floor(sinceEpochDayStart / perDay);
  const minuteOfDay = sinceEpochDayStart - dayOffset * perDay;

  // Walk from the start of the epoch's year to the right year, then month.
  let remaining = ordinals(calendar, epoch, epoch.year).all + dayOffset;
  let year = epoch.year;
  while (remaining >= yearDays(calendar, year)) {
    remaining -= yearDays(calendar, year);
    year++;
  }
  while (remaining < 0) {
    year--;
    remaining += yearDays(calendar, year);
  }
  let month = 1;
  while (remaining >= monthDays(calendar, year, month)) {
    remaining -= monthDays(calendar, year, month);
    month++;
  }
  const day = remaining + 1;
  const hour = Math.floor(minuteOfDay / calendar.minutesPerHour);
  const intercalary = calendar.months[month - 1]?.intercalary ?? false;
  return {
    year,
    month,
    day,
    hour,
    minute: minuteOfDay % calendar.minutesPerHour,
    weekday: weekdayOf(calendar, epoch, epochWeekday, { year, month, day }),
    intercalary,
    timeOfDay: timeOfDay(calendar, hour),
  };
}

// Counts only weekday-bearing days from the epoch, so festivals don't advance the week
// (TIME-003).
function weekdayOf(
  calendar: CalendarDefinition,
  epoch: CalendarDate,
  epochWeekday: number,
  date: DayDate,
): number | null {
  if (calendar.weekdays.length === 0 || skipsWeekdays(calendar, date.month)) return null;
  const delta =
    ordinals(calendar, date, epoch.year).regular - ordinals(calendar, epoch, epoch.year).regular;
  return mod(epochWeekday + delta, calendar.weekdays.length);
}

/**
 * Minutes from `now` until the next start of a named time of day, always in the future,
 * so asking for "morning" during the morning means tomorrow's. Null if the calendar has
 * no time of day by that name. Implements TIME-021.
 */
export function minutesUntil(
  calendar: CalendarDefinition,
  epoch: CalendarDate,
  now: number,
  timeOfDayName: string,
): number | null {
  const starts = calendar.timesOfDay
    .filter((entry) => entry.name === timeOfDayName)
    .map((entry) => entry.startHour * calendar.minutesPerHour);
  if (starts.length === 0) return null;
  const perDay = dayMinutes(calendar);
  const minuteOfDay = mod(now + epoch.hour * calendar.minutesPerHour + epoch.minute, perDay);
  return Math.min(
    ...starts.map((start) =>
      start > minuteOfDay ? start - minuteOfDay : start - minuteOfDay + perDay,
    ),
  );
}

// The tokens `format` may use (TIME-010).
const formatTokens = new Set([
  'weekday',
  'day',
  'month',
  'monthNumber',
  'year',
  'era',
  'hour',
  'minute',
  'timeOfDay',
]);

/**
 * Every problem with a calendar definition that its schema cannot express. A calendar
 * with issues cannot be used. Implements TIME-004, SCH-030, and SCH-032.
 */
export function calendarIssues(calendar: CalendarDefinition): string[] {
  const issues: string[] = [];
  calendar.months.forEach((month, index) => {
    const where = `months[${String(index)}] (${month.name})`;
    if (month.days === 0 && !(month.intercalary && month.leapDays > 0)) {
      issues.push(`${where}: only an intercalary leap day may have 0 days`);
    }
    if (month.leapDays > 0 && calendar.leapRule === null) {
      issues.push(`${where}: leapDays needs a leapRule`);
    }
  });
  if (!calendar.months.some((month) => !month.intercalary && month.days > 0)) {
    issues.push('months: at least one regular month is required');
  }
  if (calendar.timesOfDay[0]?.startHour !== 0) issues.push('timesOfDay: must start at hour 0');
  calendar.timesOfDay.forEach((entry, index) => {
    if (entry.startHour >= calendar.hoursPerDay) {
      issues.push(`timesOfDay[${String(index)}]: hour ${String(entry.startHour)} does not exist`);
    }
    const previous = calendar.timesOfDay[index - 1];
    if (previous !== undefined && entry.startHour <= previous.startHour) {
      issues.push('timesOfDay: must be ordered by startHour without repeats');
    }
  });
  for (const template of [calendar.format, calendar.intercalaryFormat ?? '']) {
    for (const match of template.matchAll(/\{(\w+)\}/g)) {
      const token = match[1] ?? '';
      if (!formatTokens.has(token)) issues.push(`format: unknown token {${token}}`);
    }
  }
  return issues;
}
