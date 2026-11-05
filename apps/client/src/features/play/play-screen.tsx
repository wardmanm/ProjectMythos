import { useParams } from 'react-router';
import { useCampaign } from '@/api/campaigns';
import { FailureMessage } from '@/components/failure-message';
import { StoryColumn } from '@/components/story-column';

/**
 * Play (14-ui §5–7), at `/c/:campaignId`. A placeholder: P1-T23 builds the screen in this
 * file. The URL names no branch, so the story is the campaign's current branch, which the
 * campaign view gives (UI-001, TRN-101).
 */
export function PlayScreen() {
  const campaignId = useParams().campaignId ?? '';
  const campaign = useCampaign(campaignId);
  return (
    <section className="py-8">
      <StoryColumn>
        {campaign.isPending && <p className="text-text-muted">Opening the campaign…</p>}
        {campaign.isError && <FailureMessage error={campaign.error} />}
        {campaign.isSuccess && (
          <div data-branch-id={campaign.data.currentBranchId}>
            <h1 className="font-display text-2xl">{campaign.data.name}</h1>
          </div>
        )}
      </StoryColumn>
    </section>
  );
}
