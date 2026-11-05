// Showing game time to the player (12-time-world §2.1): dates in the calendar's own
// format, and durations in its units.
import type { CalendarDefinition } from '@mythos/contracts/content';
import { type ResolvedDate, dayMinutes } from './calendar';

/**
 * A resolved date in the calendar's `format`, or its `intercalaryFormat` on a festival.
 * Hour and minute are zero-padded, and empty tokens collapse their spaces. Implements
 * TIME-010.
 */
export function formatDate(calendar: CalendarDefinition, date: ResolvedDate): string {
  const template =
    date.intercalary && calendar.intercalaryFormat !== undefined
      ? calendar.intercalaryFormat
      : calendar.format;
  const pad = (n: number) => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    weekday: date.weekday === null ? '' : (calendar.weekdays[date.weekday] ?? ''),
    day: String(date.day),
    month: calendar.months[date.month - 1]?.name ?? '',
    monthNumber: String(date.month),
    year: String(date.year),
    era: calendar.eraSuffix,
    hour: pad(date.hour),
    minute: pad(date.minute),
    timeOfDay: date.timeOfDay,
  };
  return template
    .replace(/\{(\w+)\}/g, (_, key: string) => tokens[key] ?? `{${key}}`)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A duration in its two largest units, with the calendar's day and week lengths:
 * "3 days, 4 hours". Implements TIME-012.
 */
export function formatDuration(calendar: CalendarDefinition, minutes: number): string {
  const perDay = dayMinutes(calendar);
  const units: [string, number][] = [
    ['week', perDay * (calendar.weekdays.length || 7)],
    ['day', perDay],
    ['hour', calendar.minutesPerHour],
    ['minute', 1],
  ];
  const parts: string[] = [];
  let rest = Math.max(0, minutes);
  for (const [name, size] of units) {
    const count = Math.floor(rest / size);
    if (count > 0 && parts.length < 2) {
      parts.push(`${String(count)} ${name}${count === 1 ? '' : 's'}`);
      rest -= count * size;
    } else if (parts.length > 0) {
      // Units must be adjacent: "3 days, 5 minutes" would hide the hours.
      break;
    }
  }
  return parts.length > 0 ? parts.join(', ') : 'no time';
}
