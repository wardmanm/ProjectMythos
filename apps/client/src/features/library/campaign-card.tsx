import type { CampaignSummary } from '@mythos/contracts';
import { useId } from 'react';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { contentSummary } from './content-summary';

/** When the campaign was last played, in the device's own words for dates. */
const lastPlayedFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * One campaign in the library: its name, setting, date in game, when it was last played, and
 * its content settings in a sentence that wraps rather than being cut (CSET-023). Continue is
 * the primary action and Delete a quiet one; each names its campaign to screen readers
 * through the title.
 */
// Implements UI-083 (each campaign's card) and CSET-023.
export function CampaignCard({
  campaign,
  onDelete,
}: {
  campaign: CampaignSummary;
  onDelete: (campaign: CampaignSummary) => void;
}) {
  const titleId = useId();
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>
          <h2 id={titleId} className="font-display text-xl">
            {campaign.name}
          </h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-text-muted">Setting</dt>
          <dd>{campaign.settingName}</dd>
          <dt className="text-text-muted">In game</dt>
          <dd>{campaign.gameTimeLabel}</dd>
          <dt className="text-text-muted">Last played</dt>
          <dd>
            <time dateTime={campaign.lastPlayedAt}>
              {lastPlayedFormat.format(new Date(campaign.lastPlayedAt))}
            </time>
          </dd>
          <dt className="text-text-muted">Content</dt>
          <dd>{contentSummary(campaign.contentSettings)}</dd>
        </dl>
      </CardContent>
      <CardFooter className="gap-2">
        <Link
          to={`/c/${encodeURIComponent(campaign.campaignId)}`}
          aria-describedby={titleId}
          className={buttonVariants()}
        >
          Continue
        </Link>
        <Button
          variant="ghost"
          aria-describedby={titleId}
          onClick={() => {
            onDelete(campaign);
          }}
        >
          Delete
        </Button>
      </CardFooter>
    </Card>
  );
}
