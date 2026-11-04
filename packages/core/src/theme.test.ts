import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Theme, ThemeSchema } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import { contrast, themeIssues } from './theme';

const themesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../content-library/themes',
);
const readTheme = (file: string): Theme =>
  ThemeSchema.parse(JSON.parse(readFileSync(path.join(themesDir, file), 'utf8')));
const themeFiles = readdirSync(themesDir).filter((file) => file.endsWith('.json'));

const brine = readTheme('theme.brine.json');
const brineDark = brine.palettes.dark;

describe('contrast', () => {
  it('UI-031: black on white is 21:1, in either order', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
  });

  it('UI-031: the WCAG example #777 on white is 4.48:1, just short of AA text', () => {
    expect(contrast('#777777', '#FFFFFF').toFixed(2)).toBe('4.48');
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('themeIssues', () => {
  it('UI-130: the built-in library has themes to check', () => {
    expect(themeFiles.length).toBeGreaterThan(0);
  });

  it.each(themeFiles)('UI-130: %s passes every contrast rule and font check', (file) => {
    expect(themeIssues(readTheme(file))).toEqual([]);
  });

  it('UI-031, UI-130: a careless edit is rejected with all its issues', () => {
    if (brineDark === undefined) throw new Error('theme.brine has no dark palette');
    const broken = ThemeSchema.parse({
      ...brine,
      palettes: { dark: { ...brineDark, textMuted: '#4A5A62', playerText: brineDark.text } },
      fonts: { ...brine.fonts, narration: { family: 'comic-neue' } },
    });
    const issues = themeIssues(broken);
    expect(issues).toHaveLength(4);
    expect(issues.filter((issue) => issue.includes('textMuted on'))).toHaveLength(2);
    expect(issues).toContain(
      "palettes.dark: playerText must differ from text, so the player's words stand apart",
    );
    expect(issues).toContain('fonts.narration: unknown font "comic-neue"');
  });

  it("UI-031: a font from the theme's own pack is known", () => {
    const withPackFont = ThemeSchema.parse({
      ...brine,
      fonts: { ...brine.fonts, narration: { family: 'harbor-script' } },
    });
    expect(themeIssues(withPackFont)).toEqual(['fonts.narration: unknown font "harbor-script"']);
    expect(themeIssues(withPackFont, ['harbor-script'])).toEqual([]);
  });

  it('UI-031: a theme needs at least one palette', () => {
    const noPalettes = ThemeSchema.parse({ ...brine, palettes: {} });
    expect(themeIssues(noPalettes)).toEqual(['palettes: define at least one of dark or light']);
  });
});
