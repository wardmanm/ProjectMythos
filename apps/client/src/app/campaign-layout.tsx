import { Outlet, useParams } from 'react-router';
import { useCampaignEvents } from '@/events/use-campaign-events';

/**
 * Every screen inside a campaign (`/c/:campaignId/…`). It holds the campaign's one event
 * stream, opened when the player enters the campaign and closed when they leave it
 * (UI-101); moving between the campaign's own screens keeps it open.
 */
export function CampaignLayout() {
  const campaignId = useParams().campaignId ?? '';
  useCampaignEvents(campaignId);
  return <Outlet />;
}
