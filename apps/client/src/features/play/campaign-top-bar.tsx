import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useCampaign } from '@/api/campaigns';
import { useTurn } from '@/api/turns';

/**
 * The top bar's part on a campaign's screens (owner decision, 14-ui Decisions): the
 * campaign's name, which leads back to its story, and the head turn's date in game. The
 * name is a link, not a heading: each screen has its own h1. Until the campaign loads,
 * or if it can't, the bar shows `fallback`.
 */
export function CampaignTopBar({
  campaignId,
  fallback,
}: {
  campaignId: string;
  fallback: ReactNode;
}) {
  const campaign = useCampaign(campaignId);
  const head = useTurn(campaignId, campaign.data?.headTurnId ?? null);
  if (!campaign.isSuccess) return fallback;
  return (
    <>
      <Link
        to={`/c/${encodeURIComponent(campaignId)}`}
        className="inline-flex min-h-11 min-w-0 flex-1 items-center rounded-md px-2 font-display text-lg text-text"
      >
        <span className="truncate">{campaign.data.name}</span>
      </Link>
      {head.isSuccess && (
        <p className="max-w-1/2 min-w-0 py-1 pr-2 text-right text-sm leading-tight text-text-muted">
          {head.data.gameTimeLabel}
        </p>
      )}
    </>
  );
}
