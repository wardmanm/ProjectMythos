// A stand-in for window.matchMedia, which jsdom lacks. It answers the queries the client
// asks: light or dark, reduced motion, and `(min-width: Npx)` or `(max-width: Npx)` against
// a device width. Each test starts on a 1440 px desktop that prefers light and full motion.
import { vi } from 'vitest';

const device = { prefersDark: false, prefersReducedMotion: false, width: 1440 };
const listeners = new Set<() => void>();

function matches(media: string): boolean {
  if (media === '(prefers-color-scheme: dark)') return device.prefersDark;
  if (media === '(prefers-reduced-motion: reduce)') return device.prefersReducedMotion;
  const width = /^\((min|max)-width: (\d+)px\)$/.exec(media);
  if (width === null) return false;
  const limit = Number(width[2]);
  return width[1] === 'min' ? device.width >= limit : device.width <= limit;
}

/** Installs the fake with the default device. The test setup calls it before each test. */
export function installFakeMatchMedia(): void {
  device.prefersDark = false;
  device.prefersReducedMotion = false;
  device.width = 1440;
  listeners.clear();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return matches(media);
    },
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
  }));
}

/** Every listener rereads its query, as the browser's `change` event would make it. */
function changed(): void {
  for (const listener of listeners) listener();
}

/** Changes the device's light or dark preference, as the OS setting would. */
export function setDevicePrefersDark(dark: boolean): void {
  device.prefersDark = dark;
  changed();
}

/** Changes the device's reduced-motion preference, as the OS setting would. */
export function setDevicePrefersReducedMotion(reduced: boolean): void {
  device.prefersReducedMotion = reduced;
  changed();
}

/** Changes the screen's width in CSS pixels, e.g. 390 for a phone (14-ui §4). */
export function setDeviceWidth(px: number): void {
  device.width = px;
  changed();
}
