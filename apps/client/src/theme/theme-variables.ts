import { PaletteSchema, type Palette, type Theme } from '@mythos/contracts/content';
import { fontStack } from './fonts';

export type ColorScheme = 'light' | 'dark';

/** The CSS custom property for each palette color. Tailwind's theme reads these (index.css). */
const colorProperties = {
  background: '--color-background',
  surface: '--color-surface',
  text: '--color-text',
  textMuted: '--color-text-muted',
  playerText: '--color-player-text',
  accent: '--color-accent',
  onAccent: '--color-on-accent',
  border: '--color-border',
  positive: '--color-positive',
  caution: '--color-caution',
  negative: '--color-negative',
} as const satisfies Record<keyof Palette, `--color-${string}`>;

/** The narration base size for each `narration.size` (14-ui §3.1). */
const narrationSizes = { small: '17px', medium: '19px', large: '21px' } as const;

/**
 * The scheme a theme shows when the device prefers `preferred`. Implements UI-033: a
 * theme with both palettes follows the device; a theme with one uses it everywhere.
 */
export function appliedScheme(theme: Theme, preferred: ColorScheme): ColorScheme {
  const other = preferred === 'dark' ? 'light' : 'dark';
  if (theme.palettes[preferred] !== undefined) return preferred;
  if (theme.palettes[other] !== undefined) return other;
  throw new Error(`${theme.id} has no palette; themeIssues rejects such a theme (UI-031)`);
}

/**
 * Every custom property a theme sets on the document root, for one of its palettes.
 * Implements UI-032. `scheme` must name a palette the theme has: use `appliedScheme`.
 */
export function themeVariables(theme: Theme, scheme: ColorScheme): Record<string, string> {
  const palette = theme.palettes[scheme];
  if (palette === undefined) {
    throw new Error(`${theme.id} has no ${scheme} palette; pick one with appliedScheme`);
  }
  const variables: Record<string, string> = {};
  for (const color of PaletteSchema.keyof().options) {
    variables[colorProperties[color]] = palette[color];
  }
  const { fonts, narration, shape } = theme;
  variables['--font-narration'] = fontStack(fonts.narration.family);
  variables['--font-interface'] = fontStack(fonts.interface.family);
  variables['--font-display'] = fontStack((fonts.display ?? fonts.narration).family);
  variables['--font-mechanics'] = fontStack((fonts.mechanics ?? fonts.interface).family);
  variables['--narration-size'] = narrationSizes[narration.size];
  variables['--narration-line-height'] = String(narration.lineHeight);
  variables['--narration-measure'] = `${String(narration.measure)}ch`;
  variables['--radius'] = `${String(shape.radius)}px`;
  return variables;
}
