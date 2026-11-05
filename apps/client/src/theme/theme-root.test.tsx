import { ThemeSchema } from '@mythos/contracts/content';
import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setDevicePrefersDark } from '@/test/fake-match-media';
import { renderApp } from '@/test/render-app';
import { houseTheme } from './house-theme';
import { applyTheme } from './theme-root';

const root = document.documentElement;
const variable = (name: string) => root.style.getPropertyValue(name);

describe('ThemeRoot', () => {
  it("UI-032, UI-033: the shell carries theme.house's light variables on a light device", async () => {
    renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    expect(variable('--color-background')).toBe(houseTheme.palettes.light?.background);
    expect(variable('--color-text')).toBe(houseTheme.palettes.light?.text);
    expect(variable('--color-accent')).toBe(houseTheme.palettes.light?.accent);
    expect(variable('--font-narration')).toBe("'Literata', serif");
    expect(variable('--narration-measure')).toBe('66ch');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it("UI-032, UI-033: the shell carries theme.house's dark variables on a dark device", async () => {
    setDevicePrefersDark(true);
    renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    expect(variable('--color-background')).toBe(houseTheme.palettes.dark?.background);
    expect(variable('--color-text')).toBe(houseTheme.palettes.dark?.text);
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('UI-033: the variables follow the device when its preference changes', async () => {
    renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    act(() => {
      setDevicePrefersDark(true);
    });
    expect(variable('--color-text')).toBe(houseTheme.palettes.dark?.text);
    act(() => {
      setDevicePrefersDark(false);
    });
    expect(variable('--color-text')).toBe(houseTheme.palettes.light?.text);
  });

  it('UI-033: a theme with one palette applies it under both preferences', () => {
    const darkOnly = ThemeSchema.parse({
      ...houseTheme,
      palettes: { dark: houseTheme.palettes.dark },
    });
    applyTheme(root, darkOnly, 'light');
    expect(variable('--color-text')).toBe(houseTheme.palettes.dark?.text);
    expect(root.classList.contains('dark')).toBe(true);
    applyTheme(root, darkOnly, 'dark');
    expect(variable('--color-text')).toBe(houseTheme.palettes.dark?.text);
  });
});
