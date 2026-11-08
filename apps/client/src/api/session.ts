import { SessionStateSchema } from '@mythos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, requestNoContent } from './client';
import { queryKeys } from './query-keys';

/** Whether this device needs the PIN, and whether it has a session: `GET /session` (ARCH-110). */
export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: ({ signal }) => request('/session', SessionStateSchema, { signal }),
  });
}

/**
 * Logs in with the PIN: `POST /session`, which answers `204` with a session cookie
 * (ARCH-110). Every query is then invalidated, since any the PIN lock refused can now
 * succeed.
 */
export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pin: string) => requestNoContent('/session', { method: 'POST', body: { pin } }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
  });
}
