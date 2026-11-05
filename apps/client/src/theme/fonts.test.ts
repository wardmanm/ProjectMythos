import { BUNDLED_FONTS } from '@mythos/contracts/content';
import { describe, expect, it } from 'vitest';
import clientPackage from '../../package.json';
import { bundledFaces, fontStack } from './fonts';
import { houseTheme } from './house-theme';

const houseFaces = Object.values(houseTheme.fonts).flatMap((font) =>
  font === undefined ? [] : [font.family],
);

describe('fonts', () => {
  it('UI-034: every face theme.house names is bundled with the app', () => {
    const dependencies: Record<string, string> = clientPackage.dependencies;
    expect(houseFaces.length).toBeGreaterThan(0);
    for (const face of houseFaces) {
      expect(BUNDLED_FONTS, face).toContain(face);
      expect(bundledFaces.has(face), face).toBe(true);
      expect(dependencies[`@fontsource/${face}`], face).toBeDefined();
    }
  });

  it('UI-034: a bundled face falls back to its generic family, and an unknown one to sans-serif', () => {
    expect(fontStack('literata')).toBe("'Literata', serif");
    expect(fontStack('no-such-face')).toBe('sans-serif');
  });
});
