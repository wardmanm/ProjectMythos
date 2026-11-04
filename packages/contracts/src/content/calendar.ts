import { z } from 'zod';
import { CalendarIdSchema, ContentSchemaVersionSchema } from './common';

export const CalendarMonthSchema = z.strictObject({
  name: z.string().min(1).max(40),
  /** 0 is allowed for an intercalary day that exists only in leap years (via leapDays). */
  days: z.int().min(0).max(400),
  /** Intercalary periods (festival days) sit between months and have no weekday if weekdaysSkipIntercalary. */
  intercalary: z.boolean().default(false),
  /** Days added to this month in leap years. */
  leapDays: z.int().min(0).max(10).default(0),
});

export const LeapRuleSchema = z.strictObject({
  every: z.int().min(2), // e.g. 4
  exceptEvery: z.int().min(2).optional(), // e.g. 100
  unlessEvery: z.int().min(2).optional(), // e.g. 400
});

export const TimeOfDaySchema = z.strictObject({
  name: z.string().min(1).max(40), // e.g. "dawn"
  startHour: z.int().min(0),
});

export const CalendarDefinitionSchema = z.strictObject({
  schemaVersion: ContentSchemaVersionSchema,
  id: CalendarIdSchema,
  name: z.string().min(1).max(80),
  minutesPerHour: z.int().min(1).default(60),
  hoursPerDay: z.int().min(1).default(24),
  months: z.array(CalendarMonthSchema).min(1),
  weekdays: z.array(z.string().min(1).max(40)), // empty = no week cycle
  weekdaysSkipIntercalary: z.boolean().default(false),
  leapRule: LeapRuleSchema.nullable().default(null),
  eraSuffix: z.string().max(20).default(''), // e.g. "DR", "AD"
  timesOfDay: z.array(TimeOfDaySchema), // ordered by startHour
  /**
   * Display format. Tokens: {weekday} {day} {month} {monthNumber} {year} {era} {hour}
   * {minute} {timeOfDay}. {hour} and {minute} are zero-padded to two digits.
   */
  format: z.string().min(1).max(120),
  /** Format for intercalary days, which often have no weekday or day number. Defaults to `format`. */
  intercalaryFormat: z.string().min(1).max(120).optional(),
});
export type CalendarDefinition = z.infer<typeof CalendarDefinitionSchema>;

/** A point on a calendar. `month` is a 1-based index into `months` (intercalary entries included). */
export const CalendarDateSchema = z.strictObject({
  year: z.int(),
  month: z.int().min(1),
  day: z.int().min(1),
  hour: z.int().min(0).default(0),
  minute: z.int().min(0).default(0),
});
export type CalendarDate = z.infer<typeof CalendarDateSchema>;
