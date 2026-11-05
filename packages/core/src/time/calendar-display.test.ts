import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CalendarDate, CalendarDefinitionSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { fromDate, toDate } from './calendar';
import { formatDate, formatDuration } from './calendar-display';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
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

describe('formatDate', () => {
  it('TIME-010: formats the spec examples', () => {
    const evening = fromDate(gregorian, gregorianEpoch, date(1874, 10, 12, 18, 0));
    expect(formatDate(gregorian, toDate(gregorian, gregorianEpoch, 6, evening))).toBe(
      'Monday, October 12, 1874 (evening)',
    );
    expect(formatDate(longCount, longCountDay(30))).toBe('Deepwinter, 1 LC (midday)');
    expect(formatDate(longCount, longCountDay(31))).toBe('Moonsday, 1 Thaw 1 LC (midday)');
  });

  it('TIME-010: pads hour and minute, collapses empty tokens, and keeps unknown ones', () => {
    // Deepwinter has no weekday, and without an intercalaryFormat it uses `format`.
    const custom = { ...longCount, format: '{weekday} {day}.{monthNumber} {hour}:{minute} {moon}' };
    delete custom.intercalaryFormat;
    const resolved = toDate(custom, longCountEpoch, 0, 30 * DAY + 7 * 60 + 5);
    expect(formatDate(custom, resolved)).toBe('1.2 07:05 {moon}');
  });
});

describe('formatDuration', () => {
  it('TIME-012: durations use the two largest adjacent units and the calendar week', () => {
    expect(formatDuration(gregorian, 45)).toBe('45 minutes');
    expect(formatDuration(gregorian, 3 * DAY + 4 * 60 + 5)).toBe('3 days, 4 hours');
    expect(formatDuration(gregorian, 30 * DAY)).toBe('4 weeks, 2 days');
    expect(formatDuration(longCount, 30 * DAY)).toBe('5 weeks');
    expect(formatDuration(gregorian, 3 * DAY + 5)).toBe('3 days');
    expect(formatDuration(gregorian, DAY + 60)).toBe('1 day, 1 hour');
    expect(formatDuration(gregorian, 0)).toBe('no time');
    expect(formatDuration(gregorian, -10)).toBe('no time');
  });

  it('TIME-012: a calendar without a week counts weeks as seven days', () => {
    expect(formatDuration({ ...gregorian, weekdays: [] }, 14 * DAY)).toBe('2 weeks');
  });
});
