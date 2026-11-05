// Theme checks (14-ui §3.2): every palette must be readable, and every font known, before
// a theme can be applied.
import { BUNDLED_FONTS, type Palette, type Theme } from '@mythos/contracts/content';

/** WCAG 2.x relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = [1, 3, 5].map((offset) => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.x contrast ratio of two `#RRGGBB` colors, from 1 to 21, in either order. */
export function contrast(a: string, b: string): number {
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The pairs every palette must satisfy, as foreground, background, and minimum ratio:
 * text at 4.5:1 (WCAG AA), and UI components at 3:1. Implements UI-031.
 */
export const CONTRAST_RULES: readonly (readonly [keyof Palette, keyof Palette, number])[] = [
  ['text', 'background', 4.5],
  ['text', 'surface', 4.5],
  ['textMuted', 'background', 4.5],
  ['textMuted', 'surface', 4.5],
  ['playerText', 'background', 4.5],
  ['onAccent', 'accent', 4.5],
  ['accent', 'background', 3],
  ['accent', 'surface', 3],
  ['positive', 'surface', 3],
  ['caution', 'surface', 3],
  ['negative', 'surface', 3],
];

/**
 * Every problem that stops a theme being applied: a missing palette, a pair below its
 * contrast minimum, player text the same as narration text, or an unknown font.
 * `packFonts` are the font families the theme's pack ships. Implements UI-031.
 */
export function themeIssues(theme: Theme, packFonts: readonly string[] = []): string[] {
  const issues: string[] = [];
  const modes = (['dark', 'light'] as const).filter((mode) => theme.palettes[mode] !== undefined);
  if (modes.length === 0) issues.push('palettes: define at least one of dark or light');
  for (const mode of modes) {
    const palette = theme.palettes[mode];
    if (palette === undefined) continue;
    for (const [foreground, background, minimum] of CONTRAST_RULES) {
      const ratio = contrast(palette[foreground], palette[background]);
      if (ratio < minimum) {
        issues.push(
          `palettes.${mode}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, needs ${String(minimum)}:1`,
        );
      }
    }
    if (palette.playerText === palette.text) {
      issues.push(
        `palettes.${mode}: playerText must differ from text, so the player's words stand apart`,
      );
    }
  }
  const known = new Set<string>([...BUNDLED_FONTS, ...packFonts]);
  for (const [role, font] of Object.entries(theme.fonts)) {
    if (font !== undefined && !known.has(font.family)) {
      issues.push(`fonts.${role}: unknown font "${font.family}"`);
    }
  }
  return issues;
}
