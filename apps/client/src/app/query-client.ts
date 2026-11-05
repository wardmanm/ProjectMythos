import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { apiFailureOf, errorCodeOf } from '@/api/api-failure';

export type QueryClientHandlers = {
  /** The PIN lock wants a session (ARCH-110): the app sends the player to /pin. */
  onAuthRequired: () => void;
  /** Another device changed the campaign (TRN-120): the app tells the player. */
  onConflict: () => void;
};

/**
 * Retries only a server that could not be reached, twice. A server's own error answer
 * would only repeat, so it is shown at once.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return apiFailureOf(error)?.kind === 'unreachable' && failureCount < 2;
}

/**
 * The app's query client. Every failed query or command passes through one handler:
 * `auth_required` goes to the PIN screen, and `conflict` refetches everything and tells
 * the player (UI-102). Commands never update the cache: events do (UI-102, ARCH-120).
 */
export function createQueryClient(handlers: QueryClientHandlers): QueryClient {
  const onError = (error: unknown): void => {
    const code = errorCodeOf(error);
    if (code === 'auth_required') handlers.onAuthRequired();
    if (code === 'conflict') {
      void queryClient.invalidateQueries();
      handlers.onConflict();
    }
  };
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { retry: shouldRetry },
      // A command is never repeated on its own: a second POST could act twice.
      mutations: { retry: false },
    },
  });
  return queryClient;
}
