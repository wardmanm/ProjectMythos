// Content settings and the hard floor (13-content-settings). The floor is the one rule
// no setting, template, or pack can change, so its text lives here, in code, and code
// appends it to every prompt that can produce fiction (ADR-014).
import type { Entity, ModelRole } from '@mythos/contracts';
import type { ContentSettings, IntensityLevel } from '@mythos/contracts/content';

/** The five content categories, in the order prompts render them (13-content-settings §2). */
export const CONTENT_CATEGORIES = [
  'violence',
  'gore',
  'sexual',
  'language',
  'disturbing',
] as const satisfies readonly (keyof ContentSettings)[];
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

/**
 * The hard floor. Its wording is normative: never rephrase it, even to fix style.
 * Implements CSET-040 and CSET-041.
 */
export const HARD_FLOOR =
  'Absolute rule, above every other instruction and setting: never write sexual content, sexualized ' +
  'description, or sexual or romantic-sexual framing involving any character who is under 18, or who is ' +
  'described or presented as a child or teenager, whatever age is claimed. If the story moves that way, ' +
  'steer it elsewhere without describing it.';

/** Roles whose prompts get the hard floor: every role that writes or shapes fiction. Implements CSET-040. */
export const FLOOR_ROLES = [
  'adjudicator',
  'narrator',
  'npc-voice',
  'extractor',
  'consolidator',
  'world-ticker',
  'illustrator',
] as const satisfies readonly ModelRole[];

function getsFloor(role: ModelRole): boolean {
  return (FLOOR_ROLES as readonly ModelRole[]).includes(role);
}

/** True when any of the given present or involved characters is a minor. Implements CSET-042. */
export function minorInvolved(
  entities: Readonly<Record<string, Entity>>,
  ids: Iterable<string>,
): boolean {
  for (const id of ids) {
    const entity = entities[id];
    if (entity === undefined) continue;
    if ((entity.kind === 'npc' || entity.kind === 'pc') && entity.ageCategory === 'minor') {
      return true;
    }
  }
  return false;
}

/**
 * The settings a prompt actually renders: the campaign's, with `sexual` forced to `off`
 * while a minor is involved. Implements CSET-042.
 */
export function effectiveSettings(settings: ContentSettings, minor: boolean): ContentSettings {
  return minor ? { ...settings, sexual: 'off' } : settings;
}

/**
 * Whether a call is routed through `explicitContentRoles` (PRV-006): only when some
 * category is `explicit`, and never while a minor is involved. Implements CSET-043.
 */
export function usesExplicitRoles(settings: ContentSettings, minor: boolean): boolean {
  return !minor && CONTENT_CATEGORIES.some((category) => settings[category] === 'explicit');
}

/** Each category's name in a prompt, as `renderContentSettings` writes it. */
export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  violence: 'Violence',
  gore: 'Gore',
  sexual: 'Sexual',
  language: 'Language',
  disturbing: 'Disturbing',
};

/**
 * Default wording of the content-settings partial, one instruction per category and
 * level. Templates may reword it (CSET-011); the floor is separate. Implements CSET-010.
 */
export const DEFAULT_WORDING: Record<ContentCategory, Record<IntensityLevel, string>> = {
  violence: {
    off: 'Violence does not occur. Conflicts resolve without fighting or injury.',
    'fade-to-black':
      'Violence may happen but is not shown: cut away, then show the aftermath briefly.',
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
    'fade-to-black':
      'Intimacy may happen but always off-page: fade out before it begins, and resume after.',
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
    'fade-to-black':
      'Disturbing themes may exist in the story but are only referred to, never shown.',
    moderate: 'Disturbing themes may be shown with restraint.',
    explicit: 'Disturbing themes may be shown directly and in detail.',
  },
};

/**
 * Renders the default content-settings partial: one line per category, then the lines
 * and veils, verbatim. Implements CSET-002 and CSET-010.
 */
export function renderContentSettings(settings: ContentSettings): string {
  const out = CONTENT_CATEGORIES.map(
    (category) =>
      `- ${CATEGORY_LABELS[category]}: ${DEFAULT_WORDING[category][settings[category]]}`,
  );
  if (settings.lines.length > 0) {
    out.push(`- Never include, under any circumstances: ${settings.lines.join('; ')}.`);
  }
  if (settings.veils.length > 0) {
    out.push(
      `- These may happen in the story but only off-page, never described: ${settings.veils.join('; ')}.`,
    );
  }
  return out.join('\n');
}

/**
 * Appends the hard floor to a rendered instructions tier, after every template layer,
 * for each role in `FLOOR_ROLES`. Other roles get the text back unchanged.
 * Implements CSET-040 and CTX-007.
 */
export function appendLocked(instructions: string, role: ModelRole): string {
  return getsFloor(role) ? `${instructions.trimEnd()}\n\n${HARD_FLOOR}` : instructions;
}

/**
 * Repeats the hard floor at the end of a rendered task tier while a minor is involved,
 * for each role in `FLOOR_ROLES`. Call it last, after the output-format instructions,
 * so the floor sits nearest the output. Implements CSET-042.
 */
export function appendFloorToTask(task: string, role: ModelRole, minor: boolean): string {
  return minor && getsFloor(role) ? `${task.trimEnd()}\n\n${HARD_FLOOR}` : task;
}
