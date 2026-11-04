import type { CalendarDate, CalendarDefinition } from '@mythos/contracts/content';

/*
 * Calendar math (12-time-world §2). Game time is integer minutes since the epoch; the
 * calendar only converts it for display and for input. Pure and exact.
 */

export type ResolvedDate = {
  year: number;
  month: number; // 1-based index into calendar.months
  day: number; // 1-based
  hour: number;
  minute: number;
  weekday: number | null; // index into calendar.weekdays, or null
  intercalary: boolean;
  timeOfDay: string;
};

export const dayMinutes = (c: CalendarDefinition) => c.hoursPerDay * c.minutesPerHour;

export function isLeap(c: CalendarDefinition, year: number): boolean {
  const r = c.leapRule;
  if (!r) return false;
  const mod = (a: number, b: number) => ((a % b) + b) % b;
  if (mod(year, r.every) !== 0) return false;
  if (r.exceptEvery !== undefined && mod(year, r.exceptEvery) === 0) {
    return r.unlessEvery !== undefined && mod(year, r.unlessEvery) === 0;
  }
  return true;
}

export const monthDays = (c: CalendarDefinition, year: number, month: number) => {
  const m = c.months[month - 1];
  if (!m) throw new Error(`no month ${month}`);
  return m.days + (isLeap(c, year) ? m.leapDays : 0);
};

const yearDays = (c: CalendarDefinition, y: number) => c.months.reduce((a, _, i) => a + monthDays(c, y, i + 1), 0);
const yearRegularDays = (c: CalendarDefinition, y: number) =>
  c.months.reduce((a, m, i) => a + (m.intercalary && c.weekdaysSkipIntercalary ? 0 : monthDays(c, y, i + 1)), 0);

/** Days from the start of `baseYear` to the date (negative before it), and weekday-bearing days likewise. */
function ordinals(c: CalendarDefinition, d: { year: number; month: number; day: number }, baseYear: number) {
  let all = 0, regular = 0;
  for (let y = baseYear; y < d.year; y++) { all += yearDays(c, y); regular += yearRegularDays(c, y); }
  for (let y = d.year; y < baseYear; y++) { all -= yearDays(c, y); regular -= yearRegularDays(c, y); }
  for (let m = 1; m < d.month; m++) {
    const n = monthDays(c, d.year, m);
    all += n;
    if (!(c.months[m - 1]?.intercalary && c.weekdaysSkipIntercalary)) regular += n;
  }
  return { all: all + d.day - 1, regular: regular + d.day - 1 };
}

/** Every problem with a date on this calendar (SCH-031). */
export function dateIssues(c: CalendarDefinition, d: CalendarDate): string[] {
  const out: string[] = [];
  if (d.month < 1 || d.month > c.months.length) return [`month ${d.month} does not exist`];
  const n = monthDays(c, d.year, d.month);
  if (n === 0) out.push(`${c.months[d.month - 1]?.name} only exists in leap years`);
  else if (d.day > n) out.push(`${c.months[d.month - 1]?.name} ${d.year} has ${n} day${n === 1 ? '' : 's'}`);
  if (d.hour >= c.hoursPerDay) out.push(`hour ${d.hour} does not exist`);
  if (d.minute >= c.minutesPerHour) out.push(`minute ${d.minute} does not exist`);
  return out;
}

export function timeOfDay(c: CalendarDefinition, hour: number): string {
  let name = c.timesOfDay[0]?.name ?? '';
  for (const t of c.timesOfDay) if (t.startHour <= hour) name = t.name;
  return name;
}

export function fromDate(c: CalendarDefinition, epoch: CalendarDate, d: CalendarDate): number {
  const days = ordinals(c, d, epoch.year).all - ordinals(c, epoch, epoch.year).all;
  return days * dayMinutes(c) + (d.hour - epoch.hour) * c.minutesPerHour + (d.minute - epoch.minute);
}

export function toDate(c: CalendarDefinition, epoch: CalendarDate, epochWeekday: number, gameTime: number): ResolvedDate {
  const dm = dayMinutes(c);
  const total = gameTime + epoch.hour * c.minutesPerHour + epoch.minute;
  const dayOffset = Math.floor(total / dm);
  const minuteOfDay = total - dayOffset * dm;
  let rem = ordinals(c, epoch, epoch.year).all + dayOffset;
  let year = epoch.year;
  while (rem >= yearDays(c, year)) { rem -= yearDays(c, year); year++; }
  while (rem < 0) { year--; rem += yearDays(c, year); }
  let month = 1;
  while (rem >= monthDays(c, year, month)) { rem -= monthDays(c, year, month); month++; }
  const day = rem + 1;
  const hour = Math.floor(minuteOfDay / c.minutesPerHour);
  const intercalary = c.months[month - 1]?.intercalary ?? false;
  let weekday: number | null = null;
  if (c.weekdays.length && !(intercalary && c.weekdaysSkipIntercalary)) {
    const n = c.weekdays.length;
    const delta = ordinals(c, { year, month, day }, epoch.year).regular - ordinals(c, epoch, epoch.year).regular;
    weekday = (((epochWeekday + delta) % n) + n) % n;
  }
  return { year, month, day, hour, minute: minuteOfDay % c.minutesPerHour, weekday, intercalary, timeOfDay: timeOfDay(c, hour) };
}

export function formatDate(c: CalendarDefinition, d: ResolvedDate): string {
  const tpl = d.intercalary && c.intercalaryFormat ? c.intercalaryFormat : c.format;
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    weekday: d.weekday === null ? '' : (c.weekdays[d.weekday] ?? ''), day: String(d.day),
    month: c.months[d.month - 1]?.name ?? '', monthNumber: String(d.month), year: String(d.year),
    era: c.eraSuffix, hour: pad(d.hour), minute: pad(d.minute), timeOfDay: d.timeOfDay,
  };
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => tokens[k] ?? `{${k}}`).replace(/\s+/g, ' ').trim();
}

/** Minutes from `now` until the next start of a time of day, strictly in the future (TIME-021). */
export function minutesUntil(c: CalendarDefinition, epoch: CalendarDate, now: number, timeOfDayName: string): number | null {
  const starts = c.timesOfDay.filter((t) => t.name === timeOfDayName).map((t) => t.startHour * c.minutesPerHour);
  if (!starts.length) return null;
  const dm = dayMinutes(c);
  const minuteOfDay = (((now + epoch.hour * c.minutesPerHour + epoch.minute) % dm) + dm) % dm;
  return Math.min(...starts.map((s) => (s > minuteOfDay ? s - minuteOfDay : s - minuteOfDay + dm)));
}

/** "3 days, 4 hours" (TIME-012). Largest two units, calendar-aware. */
export function formatDuration(c: CalendarDefinition, minutes: number): string {
  const dm = dayMinutes(c);
  const units: [string, number][] = [['week', dm * (c.weekdays.length || 7)], ['day', dm], ['hour', c.minutesPerHour], ['minute', 1]];
  const parts: string[] = [];
  let rest = Math.max(0, minutes);
  for (const [name, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0 && parts.length < 2) { parts.push(`${n} ${name}${n === 1 ? '' : 's'}`); rest -= n * size; }
    else if (parts.length) break;
  }
  return parts.length ? parts.join(', ') : 'no time';
}

/** Every problem with a calendar definition (SCH-030, SCH-032, TIME-004). */
export function calendarIssues(c: CalendarDefinition): string[] {
  const out: string[] = [];
  c.months.forEach((m, i) => {
    if (m.days === 0 && !(m.intercalary && m.leapDays > 0)) out.push(`months[${i}] (${m.name}): only an intercalary leap day may have 0 days`);
    if (m.leapDays > 0 && !c.leapRule) out.push(`months[${i}] (${m.name}): leapDays needs a leapRule`);
  });
  if (!c.months.some((m) => !m.intercalary && m.days > 0)) out.push('months: at least one regular month is required');
  if (c.timesOfDay[0]?.startHour !== 0) out.push('timesOfDay: must start at hour 0');
  c.timesOfDay.forEach((t, i) => {
    if (t.startHour >= c.hoursPerDay) out.push(`timesOfDay[${i}]: hour ${t.startHour} does not exist`);
    const prev = c.timesOfDay[i - 1];
    if (prev && t.startHour <= prev.startHour) out.push('timesOfDay: must be ordered by startHour without repeats');
  });
  const ok = new Set(['weekday', 'day', 'month', 'monthNumber', 'year', 'era', 'hour', 'minute', 'timeOfDay']);
  for (const f of [c.format, c.intercalaryFormat ?? ''])
    for (const m of f.matchAll(/\{(\w+)\}/g)) if (!ok.has(m[1] as string)) out.push(`format: unknown token {${m[1]}}`);
  return out;
}
