import type { TurnView } from '@mythos/contracts';
import { CircleAlertIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useCancelTurn, useRetryNarration } from '@/api/turns';
import { Button } from '@/components/ui/button';
import { CommandFailure } from './command-failure';

type FailedTurnProps = {
  campaignId: string;
  branchId: string;
  /** A `stage-failed` turn, which is always its branch's head (TRN-058). */
  view: TurnView;
  /** Called with a cancelled turn's input, which goes back in the dock (TRN-047). */
  onInputReturned: (text: string) => void;
};

/**
 * Implements UI-059's phase-1 subset: a failed narration says so in words and with the
 * negative color and an icon (UI-114), with its fixes. **Retry** runs the narration
 * again. On any turn after the opening, **Cancel turn** abandons it and puts its input
 * back in the dock, which TRN-058's "fixed or cancelled" needs. The words are general,
 * because the failure's own error is not kept with the turn (06-turn-engine Open).
 */
export function FailedTurn({ campaignId, branchId, view, onInputReturned }: FailedTurnProps) {
  const retry = useRetryNarration(campaignId);
  const cancel = useCancelTurn(campaignId);
  const turnId = view.turn.id;
  const isOpening = view.turn.parentTurnId === null;
  const busy = retry.isPending || cancel.isPending;
  const cancelTurn = () => {
    cancel.mutate(
      { turnId },
      {
        onSuccess: (cancelled) => {
          if (cancelled.turn.status === 'abandoned' && cancelled.input !== null) {
            onInputReturned(cancelled.input.text);
          }
        },
      },
    );
  };
  return (
    <div
      data-failure
      className="flex flex-col gap-3 rounded-lg border border-l-4 border-l-negative bg-surface p-3 font-interface text-base"
    >
      <div className="flex items-start gap-3">
        <CircleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-negative" />
        <p className="min-w-0">
          {isOpening
            ? "The opening couldn't be written."
            : "The narration for this turn couldn't be written."}{' '}
          Retry, or check the narrator&apos;s model in{' '}
          <Link to="/settings" className="text-accent underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() => {
            retry.mutate({ branchId, turnId });
          }}
        >
          {retry.isPending ? 'Retrying…' : 'Retry'}
        </Button>
        {!isOpening && (
          <Button variant="outline" disabled={busy} onClick={cancelTurn}>
            Cancel turn
          </Button>
        )}
      </div>
      <CommandFailure error={retry.error} />
      <CommandFailure error={cancel.error} />
    </div>
  );
}
