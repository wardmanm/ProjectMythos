import { useCallback, useSyncExternalStore } from 'react';

/** Whether a CSS media query matches now, kept current as the device changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => {
        list.removeEventListener('change', onChange);
      };
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

/** Where the tablet layout starts (14-ui §4): anything narrower is a phone. */
export const TABLET_QUERY = '(min-width: 640px)';

/** Whether the screen is phone width, below 640 px (14-ui §4). */
export function useIsPhone(): boolean {
  return !useMediaQuery(TABLET_QUERY);
}

/** Whether the device asks for reduced motion. Phase 1 follows the system only (UI-103). */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}
