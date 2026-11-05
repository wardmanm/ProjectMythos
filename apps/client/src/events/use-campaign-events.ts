import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNoticeStore } from '@/stores/notice-store';
import { applyServerEvent, resyncCampaign } from './apply-server-event';
import { openCampaignEvents } from './campaign-events';

/**
 * Keeps the open campaign's event stream connected while the component that calls it is
 * mounted, writing each event into the query cache. Only CampaignLayout calls it, so a
 * campaign has one stream however many screens show it (UI-101, ARCH-120).
 */
export function useCampaignEvents(campaignId: string): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const context = { queryClient, campaignId, notify: useNoticeStore.getState().show };
    return openCampaignEvents({
      campaignId,
      onPayload: (payload) => {
        applyServerEvent(context, payload);
      },
      onReopened: () => {
        resyncCampaign(queryClient, campaignId);
      },
    });
  }, [queryClient, campaignId]);
}
