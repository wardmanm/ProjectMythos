import type { QueryClient } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import { wordsForCode } from '@/api/plain-words';
import { useNoticeStore } from '@/stores/notice-store';
import { Providers } from './providers';
import { createQueryClient } from './query-client';
import type { AppRouter } from './router';

export type AppParts = { router: AppRouter; queryClient: QueryClient };

/**
 * Wires a router to a new query client: `auth_required` from any request goes to the PIN
 * screen with the current address to return to (ARCH-110), and `conflict` shows the
 * notice (UI-102). main.tsx and the tests both build the app this way.
 */
export function createApp(router: AppRouter): AppParts {
  const queryClient = createQueryClient({
    onAuthRequired: () => {
      const { pathname, search } = router.state.location;
      if (pathname === '/pin') return;
      void router.navigate(`/pin?next=${encodeURIComponent(pathname + search)}`);
    },
    onConflict: () => {
      useNoticeStore.getState().show({ tone: 'info', text: wordsForCode('conflict') });
    },
  });
  return { router, queryClient };
}

/** The whole app. */
export function App({ router, queryClient }: AppParts) {
  return (
    <Providers queryClient={queryClient}>
      <RouterProvider router={router} />
    </Providers>
  );
}
