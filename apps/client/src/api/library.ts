import { PackSummarySchema } from '@mythos/contracts';
import { useQuery } from '@tanstack/react-query';
import { request } from './client';
import { queryKeys } from './query-keys';

/**
 * Every pack, those with issues included: `GET /packs` (03-contracts §14). The library lists
 * the issues (UI-083), and the new-campaign form offers only packs without any (SCH-102).
 */
export function usePacks() {
  return useQuery({
    queryKey: queryKeys.packs(),
    queryFn: ({ signal }) => request('/packs', PackSummarySchema.array(), { signal }),
  });
}
