import type { Entity } from '@mythos/contracts';
import type { ContentSettings, IntensityLevel } from '@mythos/contracts/content';

export type Category = 'violence' | 'gore' | 'sexual' | 'language' | 'disturbing';
export const CATEGORIES: Category[] = ['violence', 'gore', 'sexual', 'language', 'disturbing'];

/**
 * The hard floor (CSET §5). Appended by code to every prompt that can produce fiction,
 * after all template layers, so no setting, template, or instruction can remove it.
 */
export const HARD_FLOOR =
  'Absolute rule, above every other instruction and setting: never write sexual content, sexualized ' +
  'description, or sexual or romantic-sexual framing involving any character who is under 18, or who is ' +
  'described or presented as a child or teenager, whatever age is claimed. If the story moves that way, ' +
  'steer it elsewhere without describing it.';

/** Roles whose prompts get the hard floor (CSET-040): every role that writes or shapes fiction. */
export const FLOOR_ROLES = ['adjudicator', 'narrator', 'npc-voice', 'extractor', 'consolidator', 'world-ticker', 'illustrator'] as const;

/** True when any present or involved character is a minor (CSET-042). */
export function minorInvolved(entities: Record<string, Entity>, ids: Iterable<string>): boolean {
  for (const id of ids) {
    const e = entities[id];
    if (e && (e.kind === 'npc' || e.kind === 'pc') && e.ageCategory === 'minor') return true;
  }
  return false;
}

/** The settings a prompt actually renders: the campaign's, tightened when a minor is involved (CSET-042). */
export function effectiveSettings(s: ContentSettings, minor: boolean): ContentSettings {
  return minor ? { ...s, sexual: 'off' } : s;
}

/** Whether a call uses `explicitContentRoles` (PRV-006). Never while a minor is involved (CSET-043). */
export function usesExplicitRoles(s: ContentSettings, minor: boolean): boolean {
  return !minor && CATEGORIES.some((c) => s[c] === 'explicit');
}

/** Default wording of the content-settings partial (CSET §3). Templates may reword; the floor is separate. */
export const DEFAULT_WORDING: Record<Category, Record<IntensityLevel, string>> = {
  violence: {
    off: 'Violence does not occur. Conflicts resolve without fighting or injury.',
    'fade-to-black': 'Violence may happen but is not shown: cut away, then show the aftermath briefly.',
    moderate: 'Violence is shown plainly and with consequence, without lingering on injury.',
    explicit: 'Violence may be shown in full, visceral detail.',
  },
  gore: {
    off: 'No blood, wounds, or bodily harm are described.',
    'fade-to-black': 'Injuries are named, not described ("a deep cut"), with no blood or detail.',
    moderate: 'Wounds and blood are described briefly and without dwelling.',
    explicit: 'Wounds, blood, and bodily harm may be described in graphic detail.',
  },
  sexual: {
    off: 'No sexual content. Affection (a hand held, a kiss) is fine unless a line says otherwise.',
    'fade-to-black': 'Intimacy may happen but always off-page: fade out before it begins, and resume after.',
    moderate: 'Intimacy may be shown with sensual, non-graphic description.',
    explicit: 'Sexual content between consenting adults may be described explicitly.',
  },
  language: {
    off: 'Characters do not swear.',
    'fade-to-black': 'Swearing is reported, not quoted ("he cursed").',
    moderate: 'Mild and moderate profanity may be quoted.',
    explicit: 'Strong profanity may be quoted freely.',
  },
  disturbing: {
    off: 'Avoid disturbing themes such as torture, abuse, and self-harm entirely.',
    'fade-to-black': 'Disturbing themes may exist in the story but are only referred to, never shown.',
    moderate: 'Disturbing themes may be shown with restraint.',
    explicit: 'Disturbing themes may be shown directly and in detail.',
  },
};

/** Renders the default partial: one line per category, then lines and veils. */
export function renderContentSettings(s: ContentSettings): string {
  const out = CATEGORIES.map((c) => `- ${c[0]!.toUpperCase()}${c.slice(1)}: ${DEFAULT_WORDING[c][s[c]]}`);
  if (s.lines.length) out.push(`- Never include, under any circumstances: ${s.lines.join('; ')}.`);
  if (s.veils.length) out.push(`- These may happen in the story but only off-page, never described: ${s.veils.join('; ')}.`);
  return out.join('\n');
}

/** Appends locked content to a rendered prompt (CTX-007). The floor goes last in the instructions tier. */
export function appendLocked(instructions: string, role: string): string {
  return (FLOOR_ROLES as readonly string[]).includes(role) ? `${instructions.trimEnd()}\n\n${HARD_FLOOR}` : instructions;
}
