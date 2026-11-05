// A stand-in for window.matchMedia, which jsdom lacks. Only `(prefers-color-scheme: dark)`
// ever matches, and only while a test says the device prefers dark.
import { vi } from 'vitest';

const darkQuery = '(prefers-color-scheme: dark)';
let prefersDark = false;
const listeners = new Set<() => void>();

/** Installs the fake with the device preferring light. The test setup calls it before each test. */
export function installFakeMatchMedia(): void {
  prefersDark = false;
  listeners.clear();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return media === darkQuery && prefersDark;
    },
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  }));
}

/** Changes the device's light or dark preference, as the OS setting would. */
export function setDevicePrefersDark(dark: boolean): void {
  prefersDark = dark;
  for (const listener of listeners) listener();
}
