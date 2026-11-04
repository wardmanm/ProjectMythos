import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CalendarDate, CalendarDefinitionSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import {
  calendarIssues,
  dateIssues,
  fromDate,
  isLeap,
  minutesUntil,
  monthDays,
  timeOfDay,
  toDate,
} from './calendar';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = (...parts: string[]): unknown =>
  JSON.parse(readFileSync(path.join(repoRoot, ...parts), 'utf8'));

const gregorian = CalendarDefinitionSchema.parse(
  readJson('content-library', 'calendars', 'calendar.gregorian.json'),
);
const longCount = CalendarDefinitionSchema.parse(
  readJson('spec', 'fixtures', 'test', 'calendars', 'calendar.long-count.json'),
);

const date = (year: number, month: number, day: number, hour = 0, minute = 0): CalendarDate => ({
  year,
  month,
  day,
  hour,
  minute,
});

const DAY = 1440;
// 1870-01-01 was a Saturday: weekday 6 with Sunday as 0.
const gregorianEpoch = date(1870, 1, 1);
const longCountEpoch = date(1, 1, 1);
/** Midday on the nth day (0-based) of the Long Count. */
const longCountDay = (days: number) => toDate(longCount, longCountEpoch, 0, days * DAY + 12 * 60);
const monthName = (month: number) => longCount.months[month - 1]?.name;

describe('toDate and fromDate', () => {
  it('TIME-001: all 518 truth-table dates and weekdays match, in both directions', () => {
    const truth = readJson('spec', 'fixtures', 'test', 'calendars', 'gregorian-truth.json');
    const rows = truth as [number, number, number, number, number, number, number][];
    expect(rows).toHaveLength(518);
    const mismatches: string[] = [];
    for (const [gameTime, year, month, day, hour, minute, weekday] of rows) {
      const resolved = toDate(gregorian, gregorianEpoch, 6, gameTime);
      const expected = { year, month, day, hour, minute, weekday };
      if (
        !Object.entries(expected).every(
          ([key, value]) => resolved[key as keyof typeof expected] === value,
        )
      ) {
        mismatches.push(`toDate(${String(gameTime)}) gave ${JSON.stringify(resolved)}`);
      }
      if (fromDate(gregorian, gregorianEpoch, date(year, month, day, hour, minute)) !== gameTime) {
        mismatches.push(
          `fromDate(${String(year)}-${String(month)}-${String(day)}) is not ${String(gameTime)}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('TIME-001: Gregorian leap rules: 1900 no, 2000 yes, 2024 yes, 2100 no', () => {
    expect([1900, 2000, 2024, 2100].map((year) => isLeap(gregorian, year))).toEqual([
      false,
      true,
      true,
      false,
    ]);
  });

  it('TIME-001: a calendar without a leap rule has no leap years', () => {
    expect(isLeap({ ...gregorian, leapRule: null }, 2000)).toBe(false);
  });

  it('TIME-001: an epoch with an hour makes game time 0 that time of day', () => {
    const epoch = date(1874, 10, 12, 6, 30);
    expect(toDate(gregorian, epoch, 1, 0)).toMatchObject({ day: 12, hour: 6, minute: 30 });
    expect(toDate(gregorian, epoch, 1, 17 * 60 + 30).day).toBe(13);
    expect(fromDate(gregorian, epoch, date(1874, 10, 13, 0, 0))).toBe(17 * 60 + 30);
  });

  it('TIME-001: game times before the epoch resolve to earlier dates and back', () => {
    const resolved = toDate(gregorian, gregorianEpoch, 6, -DAY);
    expect(resolved).toMatchObject({ year: 1869, month: 12, day: 31, weekday: 5 });
    expect(fromDate(gregorian, gregorianEpoch, resolved)).toBe(-DAY);
  });

  it('TIME-001: every sampled time over twelve Long Count years round-trips to a valid date', () => {
    const failures: number[] = [];
    for (let gameTime = 0; gameTime < 12 * 366 * DAY; gameTime += 997 * 61) {
      const resolved = toDate(longCount, longCountEpoch, 0, gameTime);
      const back = fromDate(longCount, longCountEpoch, resolved);
      if (back !== gameTime || dateIssues(longCount, resolved).length > 0) failures.push(gameTime);
    }
    expect(failures).toEqual([]);
  });

  it('TIME-002: Leapnight exists only in leap years, and is skipped in others', () => {
    expect(toDate(longCount, longCountEpoch, 0, 365 * DAY).year).toBe(2);
    expect(toDate(longCount, longCountEpoch, 0, (365 * 3 + 366) * DAY).year).toBe(5);
    expect(monthDays(longCount, 1, 11)).toBe(0);

    const longdayYear1 = fromDate(longCount, longCountEpoch, date(1, 10, 1));
    expect(monthName(toDate(longCount, longCountEpoch, 0, longdayYear1 + DAY).month)).toBe('Dry');

    const longdayYear4 = fromDate(longCount, longCountEpoch, date(4, 10, 1));
    const next = [1, 2].map((n) => toDate(longCount, longCountEpoch, 0, longdayYear4 + n * DAY));
    expect(next.map((resolved) => monthName(resolved.month))).toEqual(['Leapnight', 'Dry']);
  });

  it('TIME-003: a festival has no weekday, and the day after it continues the week', () => {
    expect(monthName(longCountDay(30).month)).toBe('Deepwinter');
    expect(longCountDay(30)).toMatchObject({ weekday: null, intercalary: true });
    expect([longCountDay(29).weekday, longCountDay(31).weekday]).toEqual([5, 0]);
  });

  it('TIME-003: weekdays run unbroken across four years of festivals', () => {
    let breaks = 0;
    let previous: number | null = null;
    for (let day = 0; day < 4 * 366; day++) {
      const { weekday } = longCountDay(day);
      if (weekday === null) continue;
      if (previous !== null && weekday !== (previous + 1) % 6) breaks++;
      previous = weekday;
    }
    expect(breaks).toBe(0);
  });

  it('TIME-003: a calendar with no weekdays gives every day a null weekday', () => {
    const noWeek = { ...gregorian, weekdays: [] };
    expect(toDate(noWeek, gregorianEpoch, 0, 5 * DAY).weekday).toBeNull();
  });
});

describe('timeOfDay and minutesUntil', () => {
  it('TIME-011: the time of day is the last entry starting at or before the hour', () => {
    expect(
      [0, 4, 5, 6, 7, 11, 13, 17, 20, 21, 23].map((hour) => timeOfDay(gregorian, hour)),
    ).toEqual([
      'night',
      'night',
      'dawn',
      'dawn',
      'morning',
      'midday',
      'afternoon',
      'evening',
      'evening',
      'night',
      'night',
    ]);
  });

  it('TIME-021: minutes until a time of day are always in the future', () => {
    const evening = fromDate(gregorian, gregorianEpoch, date(1874, 10, 12, 18, 0));
    const until = (name: string, now = evening) =>
      minutesUntil(gregorian, gregorianEpoch, now, name);
    expect(['morning', 'dawn', 'night'].map((name) => until(name))).toEqual([780, 660, 180]);
    expect(until('morning', evening + 780)).toBe(1440);
    expect(until('teatime')).toBeNull();
  });
});

describe('dateIssues and calendarIssues', () => {
  it('SCH-031: Feb 29 1900 and other impossible dates are rejected', () => {
    expect(dateIssues(gregorian, date(1900, 2, 29))).toEqual(['February 1900 has 28 days']);
    expect(dateIssues(gregorian, date(2024, 2, 29))).toEqual([]);
    expect(dateIssues(gregorian, date(2024, 13, 1))).toEqual(['month 13 does not exist']);
    expect(dateIssues(gregorian, date(2024, 1, 1, 24, 60))).toEqual([
      'hour 24 does not exist',
      'minute 60 does not exist',
    ]);
    expect(dateIssues(longCount, date(1, 11, 1))).toEqual(['Leapnight only exists in leap years']);
    expect(dateIssues(longCount, date(1, 2, 2))).toEqual(['Deepwinter 1 has 1 day']);
  });

  it('TIME-004: both shipped calendars have no issues', () => {
    expect([calendarIssues(gregorian), calendarIssues(longCount)]).toEqual([[], []]);
  });

  it('TIME-004: a broken calendar reports every problem', () => {
    const broken = CalendarDefinitionSchema.parse({
      ...longCount,
      timesOfDay: [
        { name: 'day', startHour: 6 },
        { name: 'late', startHour: 6 },
        { name: 'never', startHour: 30 },
      ],
      format: '{weekday} {moon}',
      leapRule: null,
      months: [
        { name: 'Gap', days: 0 },
        { name: 'Extra', days: 1, intercalary: true, leapDays: 1 },
      ],
    });
    expect(calendarIssues(broken)).toEqual([
      'months[0] (Gap): only an intercalary leap day may have 0 days',
      'months[1] (Extra): leapDays needs a leapRule',
      'months: at least one regular month is required',
      'timesOfDay: must start at hour 0',
      'timesOfDay: must be ordered by startHour without repeats',
      'timesOfDay[2]: hour 30 does not exist',
      'format: unknown token {moon}',
    ]);
  });

  it('TIME-002: monthDays adds leap days, and rejects a month the calendar does not have', () => {
    expect([monthDays(gregorian, 2023, 2), monthDays(gregorian, 2024, 2)]).toEqual([28, 29]);
    expect([monthDays(longCount, 1, 11), monthDays(longCount, 4, 11)]).toEqual([0, 1]);
    expect(() => monthDays(gregorian, 2024, 13)).toThrow('no month 13');
  });
});
