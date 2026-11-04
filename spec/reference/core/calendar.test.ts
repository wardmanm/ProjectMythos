import { readFileSync } from 'node:fs';
import { CalendarDefinitionSchema, type CalendarDate } from '@mythos/contracts/content';
import { calendarIssues, dateIssues, formatDate, formatDuration, fromDate, isLeap, minutesUntil, toDate } from './calendar';
import { eq, fixturePath } from '../test-support/harness';
const greg = CalendarDefinitionSchema.parse(JSON.parse(readFileSync(fixturePath('library/calendars/calendar.gregorian.json'), 'utf8')));
const lc = CalendarDefinitionSchema.parse(JSON.parse(readFileSync(fixturePath('test/calendars/calendar.long-count.json'), 'utf8')));
eq('both calendars have no issues', [calendarIssues(greg), calendarIssues(lc)], [[], []]);

// ---- Gregorian against Python's datetime, 518 dates from 1870 to 2600
const epoch: CalendarDate = { year: 1870, month: 1, day: 1, hour: 0, minute: 0 };
const truth = JSON.parse(readFileSync(fixturePath('test/calendars/gregorian-truth.json'), 'utf8')) as number[][];
const mismatches: string[] = [];
for (const [t, y, m, d, h, mi, wd] of truth) {
  const r = toDate(greg, epoch, 6, t as number);
  if (r.year !== y || r.month !== m || r.day !== d || r.hour !== h || r.minute !== mi || r.weekday !== wd) mismatches.push(`toDate(${t}) gave ${JSON.stringify(r)}`);
  if (fromDate(greg, epoch, { year: y as number, month: m as number, day: d as number, hour: h as number, minute: mi as number }) !== t) mismatches.push(`fromDate(${y}-${m}-${d} ${h}:${mi}) is not ${t}`);
}
eq(`gregorian: all ${truth.length} dates and weekdays match Python, both directions`, mismatches.slice(0, 3), []);
eq('leap rules: 1900 no, 2000 yes, 2024 yes, 2100 no', [1900, 2000, 2024, 2100].map((y) => isLeap(greg, y)), [false, true, true, false]);
eq('scenario start formats', formatDate(greg, toDate(greg, epoch, 6, fromDate(greg, epoch, { year: 1874, month: 10, day: 12, hour: 18, minute: 0 }))), 'Monday, October 12, 1874 (evening)');
eq('Feb 29 1900 is rejected', dateIssues(greg, { year: 1900, month: 2, day: 29, hour: 0, minute: 0 }), ['February 1900 has 28 days']);

// ---- epoch with an hour: game time 0 is 06:30 on the epoch day
const e2: CalendarDate = { year: 1874, month: 10, day: 12, hour: 6, minute: 30 };
eq('epoch hour honored', [toDate(greg, e2, 1, 0).hour, toDate(greg, e2, 1, 0).minute, toDate(greg, e2, 1, 17 * 60 + 30).day], [6, 30, 13]);

// ---- The Long Count: festivals, leap-only Leapnight, 6-day weeks that skip festivals
const lcEpoch: CalendarDate = { year: 1, month: 1, day: 1, hour: 0, minute: 0 };
const D = 1440;
const at = (days: number) => toDate(lc, lcEpoch, 0, days * D + 12 * 60);
eq('year 1 has 365 days, year 4 has 366', [toDate(lc, lcEpoch, 0, 365 * D).year, toDate(lc, lcEpoch, 0, (365 * 3 + 366) * D).year], [2, 5]);
eq('Deepwinter is day 31 of the year, an intercalary day without a weekday', [lc.months[at(30).month - 1]?.name, at(30).weekday, at(30).intercalary], ['Deepwinter', null, true]);
eq('the weekday after a festival continues the cycle', [at(29).weekday, at(31).weekday], [5, 0]);
eq('festival formats with the intercalary format', formatDate(lc, at(30)), 'Deepwinter, 1 LC (midday)');
eq('a regular day formats normally', formatDate(lc, at(31)), 'Moonsday, 1 Thaw 1 LC (midday)');
const longdayY1 = fromDate(lc, lcEpoch, { year: 1, month: 10, day: 1, hour: 0, minute: 0 });
eq('no Leapnight in year 1: the day after Longday is Dry 1', lc.months[toDate(lc, lcEpoch, 0, longdayY1 + D).month - 1]?.name, 'Dry');
const longdayY4 = fromDate(lc, lcEpoch, { year: 4, month: 10, day: 1, hour: 0, minute: 0 });
eq('Leapnight in year 4, then Dry 1', [toDate(lc, lcEpoch, 0, longdayY4 + D), toDate(lc, lcEpoch, 0, longdayY4 + 2 * D)].map((d) => lc.months[d.month - 1]?.name), ['Leapnight', 'Dry']);
eq('Leapnight in year 1 is rejected', dateIssues(lc, { year: 1, month: 11, day: 1, hour: 0, minute: 0 }), ['Leapnight only exists in leap years']);
let roundTrip = 0;
for (let t = 0; t < 12 * 366 * D; t += 997 * 61) {
  const r = toDate(lc, lcEpoch, 0, t);
  if (fromDate(lc, lcEpoch, r) !== t || dateIssues(lc, r).length) roundTrip++;
}
eq('long count: every sampled time over 12 years round-trips to a valid date', roundTrip, 0);
let weekBreaks = 0, prev: number | null = null;
for (let d = 0; d < 4 * 366; d++) {
  const r = at(d);
  if (r.weekday === null) continue;
  if (prev !== null && r.weekday !== (prev + 1) % 6) weekBreaks++;
  prev = r.weekday;
}
eq('weekdays run unbroken across four years of festivals', weekBreaks, 0);

// ---- helpers
const evening = fromDate(greg, epoch, { year: 1874, month: 10, day: 12, hour: 18, minute: 0 });
eq('from 18:00, morning is 13 hours away; dawn 11; night (21:00) 3', ['morning', 'dawn', 'night'].map((n) => minutesUntil(greg, epoch, evening, n)), [780, 660, 180]);
eq('already morning: until morning means tomorrow', minutesUntil(greg, epoch, evening + 780, 'morning'), 1440);
eq('durations', [formatDuration(greg, 45), formatDuration(greg, 3 * 1440 + 4 * 60 + 5), formatDuration(greg, 30 * 1440), formatDuration(lc, 30 * 1440)],
  ['45 minutes', '3 days, 4 hours', '4 weeks, 2 days', '5 weeks']);
const bad = CalendarDefinitionSchema.parse({ ...lc, timesOfDay: [{ name: 'day', startHour: 6 }], format: '{weekday} {moon}', months: [{ name: 'Gap', days: 0 }] });
eq('a broken calendar reports every problem', calendarIssues(bad).length, 4);
