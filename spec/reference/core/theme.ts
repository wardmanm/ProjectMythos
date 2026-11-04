import type { Palette, Theme } from '@mythos/contracts/content';
import { BUNDLED_FONTS } from '@mythos/contracts/content';

/** WCAG 2.x relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Pairs a palette must satisfy (UI-031): text 4.5:1 (WCAG AA), UI components 3:1. */
export const CONTRAST_RULES: [keyof Palette, keyof Palette, number][] = [
  ['text', 'background', 4.5], ['text', 'surface', 4.5],
  ['textMuted', 'background', 4.5], ['textMuted', 'surface', 4.5],
  ['playerText', 'background', 4.5],
  ['onAccent', 'accent', 4.5],
  ['accent', 'background', 3], ['accent', 'surface', 3],
  ['positive', 'surface', 3], ['caution', 'surface', 3], ['negative', 'surface', 3],
];

export function themeIssues(t: Theme, packFonts: string[] = []): string[] {
  const out: string[] = [];
  const modes = (['dark', 'light'] as const).filter((m) => t.palettes[m]);
  if (!modes.length) out.push('palettes: define at least one of dark or light');
  for (const m of modes) {
    const p = t.palettes[m] as Palette;
    for (const [fg, bg, min] of CONTRAST_RULES) {
      const r = contrast(p[fg], p[bg]);
      if (r < min) out.push(`palettes.${m}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1`);
    }
    if (p.playerText === p.text) out.push(`palettes.${m}: playerText must differ from text, so the player's words stand apart`);
  }
  const known = new Set<string>([...BUNDLED_FONTS, ...packFonts]);
  for (const [role, f] of Object.entries(t.fonts)) if (f && !known.has(f.family)) out.push(`fonts.${role}: unknown font "${f.family}"`);
  return out;
}
