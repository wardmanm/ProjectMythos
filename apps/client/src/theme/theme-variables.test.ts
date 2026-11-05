import { ThemeSchema, type Theme } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { houseTheme } from './house-theme';
import { appliedScheme, themeVariables } from './theme-variables';

const light = houseTheme.palettes.light;
const dark = houseTheme.palettes.dark;

/** theme.house with only one of its palettes. */
function withOnly(scheme: 'light' | 'dark'): Theme {
  return ThemeSchema.parse({ ...houseTheme, palettes: { [scheme]: houseTheme.palettes[scheme] } });
}

describe('themeVariables', () => {
  it('UI-032: every palette color becomes a --color variable', () => {
    const variables = themeVariables(houseTheme, 'light');
    expect(variables).toMatchObject({
      '--color-background': light?.background,
      '--color-surface': light?.surface,
      '--color-text': light?.text,
      '--color-text-muted': light?.textMuted,
      '--color-player-text': light?.playerText,
      '--color-accent': light?.accent,
      '--color-on-accent': light?.onAccent,
      '--color-border': light?.border,
      '--color-positive': light?.positive,
      '--color-caution': light?.caution,
      '--color-negative': light?.negative,
    });
    expect(themeVariables(houseTheme, 'dark')['--color-text']).toBe(dark?.text);
  });

  it('UI-032: fonts, narration, and corners become variables too', () => {
    expect(themeVariables(houseTheme, 'light')).toMatchObject({
      '--font-narration': "'Literata', serif",
      '--font-interface': "'Atkinson Hyperlegible', sans-serif",
      '--narration-size': '19px',
      '--narration-line-height': '1.6',
      '--narration-measure': '66ch',
      '--radius': '6px',
    });
  });

  it('UI-032: display falls back to the narration face, and mechanics to the interface face', () => {
    const variables = themeVariables(houseTheme, 'light');
    expect(variables['--font-display']).toBe(variables['--font-narration']);
    expect(variables['--font-mechanics']).toBe(variables['--font-interface']);

    const named = ThemeSchema.parse({
      ...houseTheme,
      fonts: { ...houseTheme.fonts, display: { family: 'atkinson-hyperlegible' } },
    });
    expect(themeVariables(named, 'light')['--font-display']).toBe(
      "'Atkinson Hyperlegible', sans-serif",
    );
  });

  it('UI-032: each narration size has its base size in pixels', () => {
    const sizeOf = (size: 'small' | 'medium' | 'large') =>
      themeVariables({ ...houseTheme, narration: { ...houseTheme.narration, size } }, 'light')[
        '--narration-size'
      ];
    expect([sizeOf('small'), sizeOf('medium'), sizeOf('large')]).toEqual(['17px', '19px', '21px']);
  });

  it('UI-032: asking for a palette the theme lacks is a programmer error', () => {
    expect(() => themeVariables(withOnly('dark'), 'light')).toThrow(/no light palette/);
  });
});

describe('appliedScheme', () => {
  it("UI-033: a theme with both palettes follows the device's preference", () => {
    expect(appliedScheme(houseTheme, 'light')).toBe('light');
    expect(appliedScheme(houseTheme, 'dark')).toBe('dark');
  });

  it('UI-033: a theme with one palette uses it under either preference', () => {
    expect(appliedScheme(withOnly('dark'), 'light')).toBe('dark');
    expect(appliedScheme(withOnly('dark'), 'dark')).toBe('dark');
    expect(appliedScheme(withOnly('light'), 'dark')).toBe('light');
  });
});
