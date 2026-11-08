import type { CampaignSummary } from '@mythos/contracts';
import { CircleAlertIcon } from 'lucide-react';
import { Link } from 'react-router';
import { errorCodeOf } from '@/api/api-failure';
import { useDeleteCampaign } from '@/api/campaigns';
import { FailureMessage } from '@/components/failure-message';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useNoticeStore } from '@/stores/notice-store';

/**
 * Asks before deleting a campaign, then runs the delete (UI-083). Cancel has the focus first.
 * The confirm is a plain button, not `AlertDialogAction`, which would close the dialog before
 * the answer came. The outcomes (14-ui Decisions):
 * - deleted: the dialog closes once the list is refetched, and the notice says so;
 * - `not_found`: someone deleted it already, so the same, saying that instead;
 * - `turn_in_progress`: nothing is deleted, and the dialog says to stop the narration first;
 * - anything else: the failure in plain words (UI-122), and the dialog stays open.
 */
export function DeleteCampaignDialog({
  campaign,
  onClose,
}: {
  campaign: CampaignSummary;
  onClose: () => void;
}) {
  const deletion = useDeleteCampaign();
  const show = useNoticeStore((state) => state.show);
  const pending = deletion.isPending;

  function confirm(): void {
    deletion.mutate(campaign.campaignId, {
      onSuccess: () => {
        show({ tone: 'info', text: `Deleted ${campaign.name}.` });
        onClose();
      },
      onError: (error) => {
        if (errorCodeOf(error) !== 'not_found') return;
        show({ tone: 'info', text: 'That campaign was already deleted.' });
        onClose();
      },
    });
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {campaign.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the campaign and its whole history from this computer. It can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deletion.isError && <DeleteFailure error={deletion.error} campaign={campaign} />}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={confirm}>
            {pending ? 'Deleting…' : 'Delete campaign'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Why the delete did not happen. A narrating campaign gets the library's own words: the
 * generic ones for `turn_in_progress` speak of a turn on the screen, which isn't open here.
 */
// Implements UI-122: what happened, and what to do.
function DeleteFailure({ error, campaign }: { error: unknown; campaign: CampaignSummary }) {
  if (errorCodeOf(error) !== 'turn_in_progress') return <FailureMessage error={error} />;
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-l-4 border-l-negative bg-surface p-3"
    >
      <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-negative" />
      <div className="min-w-0">
        <p>
          This campaign is still narrating. Open it and press Stop, or let the narration finish,
          then delete it.
        </p>
        <Link
          to={`/c/${encodeURIComponent(campaign.campaignId)}`}
          className="inline-flex min-h-11 items-center rounded-md text-accent underline underline-offset-4"
        >
          Open {campaign.name}
        </Link>
      </div>
    </div>
  );
}
