import type { Theme } from '@mythos/contracts/content';
import { useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import { chooseTheme } from './choose-theme';
import { houseTheme } from './house-theme';
import { appliedScheme, themeVariables, type ColorScheme } from './theme-variables';

const darkQuery = '(prefers-color-scheme: dark)';

/** The device's light or dark preference right now. */
export function preferredScheme(): ColorScheme {
  return window.matchMedia(darkQuery).matches ? 'dark' : 'light';
}

function subscribeToPreference(onChange: () => void): () => void {
  const query = window.matchMedia(darkQuery);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

/**
 * Writes a theme onto `root` as custom properties, with `color-scheme` and the `dark`
 * class that the components' `dark:` styles read. Implements UI-032 and UI-033.
 */
export function applyTheme(root: HTMLElement, theme: Theme, preferred: ColorScheme): void {
  const scheme = appliedScheme(theme, preferred);
  for (const [property, value] of Object.entries(themeVariables(theme, scheme))) {
    root.style.setProperty(property, value);
  }
  root.style.setProperty('color-scheme', scheme);
  root.classList.toggle('dark', scheme === 'dark');
}

/**
 * Keeps the document root's theme current as the device's light or dark preference
 * changes. Phase 1 has no device or campaign theme, so the house theme applies (14-ui §15).
 */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const preferred = useSyncExternalStore(subscribeToPreference, preferredScheme);
  const theme = chooseTheme({ device: null, campaign: null, house: houseTheme });
  useLayoutEffect(() => {
    applyTheme(document.documentElement, theme, preferred);
  }, [theme, preferred]);
  return children;
}
