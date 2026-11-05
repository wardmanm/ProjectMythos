import { CampaignViewSchema } from '@mythos/contracts';
import { useQuery } from '@tanstack/react-query';
import { request } from './client';
import { queryKeys } from './query-keys';

/** The campaign view for the play screen: `GET /campaigns/:campaignId` (03-contracts §14.2). */
export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: queryKeys.campaign(campaignId),
    queryFn: ({ signal }) =>
      request(`/campaigns/${encodeURIComponent(campaignId)}`, CampaignViewSchema, { signal }),
  });
}
