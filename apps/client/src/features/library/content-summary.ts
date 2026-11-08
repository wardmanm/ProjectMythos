import type { ContentSettings, IntensityLevel } from '@mythos/contracts/content';

/** Each content category in 13-content-settings §2's order, with its name in the glossary. */
const CATEGORIES = [
  ['violence', 'violence'],
  ['gore', 'gore'],
  ['sexual', 'sexual content'],
  ['language', 'language'],
  ['disturbing', 'disturbing themes'],
] as const satisfies readonly (readonly [keyof ContentSettings, string])[];

const LEVEL_WORDS = {
  off: 'off',
  'fade-to-black': 'fade to black',
  moderate: 'moderate',
  explicit: 'explicit',
} as const satisfies Record<IntensityLevel, string>;

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * A campaign's content settings in one sentence, for the library: every category's level,
 * then how many lines and veils it has, e.g. "Violence moderate, gore fade to black, sexual
 * content off, language moderate, disturbing themes moderate; 1 line, 2 veils". The counts
 * are left out when both are zero, and the topics are never shown here (13-content-settings
 * Decisions).
 */
// Implements CSET-023: a campaign's intensity is visible before opening it.
export function contentSummary(settings: ContentSettings): string {
  const levels = CATEGORIES.map(
    ([category, name]) => `${name} ${LEVEL_WORDS[settings[category]]}`,
  ).join(', ');
  const sentence = levels.charAt(0).toUpperCase() + levels.slice(1);
  const { lines, veils } = settings;
  if (lines.length === 0 && veils.length === 0) return sentence;
  return `${sentence}; ${count(lines.length, 'line')}, ${count(veils.length, 'veil')}`;
}
