import {
  CampaignSummarySchema,
  CampaignViewSchema,
  type CreateCampaignCommand,
} from '@mythos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request, requestNoContent } from './client';
import { isCampaignKey, queryKeys } from './query-keys';

/** The campaign view for the play screen: `GET /campaigns/:campaignId` (03-contracts §14.2). */
export function useCampaign(campaignId: string) {
  return useQuery({
    queryKey: queryKeys.campaign(campaignId),
    queryFn: ({ signal }) =>
      request(`/campaigns/${encodeURIComponent(campaignId)}`, CampaignViewSchema, { signal }),
  });
}

/** The library's campaigns, most recently played first: `GET /campaigns` (03-contracts §14.2). */
export function useCampaigns() {
  return useQuery({
    queryKey: queryKeys.campaigns(),
    queryFn: ({ signal }) => request('/campaigns', CampaignSummarySchema.array(), { signal }),
  });
}

/**
 * Creates a campaign: `POST /campaigns`, answered with its view once turn zero is committed
 * (CON-112). No event stream covers the library, so the list is refetched (14-ui Decisions).
 */
export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (command: CreateCampaignCommand) =>
      request('/campaigns', CampaignViewSchema, { method: 'POST', body: command }),
    // Not awaited: the play screen opens at once, and the library refetches in the meantime.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaigns() });
    },
  });
}

/**
 * Deletes a campaign and its folder: `DELETE /campaigns/:campaignId`. Whatever the answer,
 * the list is refetched, and the command settles once it has been, so the card is gone when
 * the dialog closes. Once deleted, the campaign's own queries are dropped: nothing is left for
 * them to show.
 */
export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (campaignId: string) =>
      requestNoContent(`/campaigns/${encodeURIComponent(campaignId)}`, { method: 'DELETE' }),
    onSuccess: (_result, campaignId) => {
      queryClient.removeQueries({
        predicate: (query) => isCampaignKey(query.queryKey, campaignId),
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.campaigns() }),
  });
}
