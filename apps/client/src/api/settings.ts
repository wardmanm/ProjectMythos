import { MachineConfigSchema } from '@mythos/contracts';
import { useQuery } from '@tanstack/react-query';
import { request } from './client';
import { queryKeys } from './query-keys';

/**
 * The machine config: `GET /settings` (03-contracts §14). Every inline API key and the
 * PIN hash arrive as `SECRET_PLACEHOLDER` (CON-111); a save that sends a placeholder back
 * unchanged keeps the stored secret.
 */
export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => request('/settings', MachineConfigSchema, { signal }),
  });
}
