import type { TurnView } from '@mythos/contracts';
import { useEffect, useState } from 'react';
import { useCancelTurn, useSubmitAction } from '@/api/turns';

type TurnCommandsOptions = {
  campaignId: string;
  branchId: string;
  /** The branch's head as the play screen shows it; null until the turns load. */
  head: TurnView | null;
  /** The turns on screen. */
  shown: readonly TurnView[];
  /** Puts text in the dock, replacing its draft. */
  setDraft: (text: string) => void;
};

/**
 * The input dock's two commands: Send (`POST /actions`) and Stop (`POST …/cancel`).
 * Neither writes the cache (UI-102): a sent turn is on its way until the turns refetch
 * with it, after its `turn.created`, so until then the dock says "Sending…".
 */
export function useTurnCommands({
  campaignId,
  branchId,
  head,
  shown,
  setDraft,
}: TurnCommandsOptions) {
  const submit = useSubmitAction(campaignId);
  const cancel = useCancelTurn(campaignId);
  const [sentTurnId, setSentTurnId] = useState<string | null>(null);
  const sentTurnShown = sentTurnId !== null && shown.some((view) => view.turn.id === sentTurnId);
  useEffect(() => {
    if (sentTurnShown) setSentTurnId(null);
  }, [sentTurnShown]);

  const send = (text: string) => {
    if (head === null) return;
    const command = { branchId, expectedHeadTurnId: head.turn.id, mode: 'ic', text } as const;
    submit.mutate(command, {
      // The draft is cleared only once the server has the input (TRN-011).
      onSuccess: ({ turnId }) => {
        setDraft('');
        setSentTurnId(turnId);
      },
    });
  };
  const stop = () => {
    if (head === null) return;
    cancel.mutate(
      { turnId: head.turn.id },
      {
        // Stopped before any text, the turn is abandoned and its input comes back (TRN-047).
        onSuccess: (view) => {
          if (view.turn.status === 'abandoned' && view.input !== null) setDraft(view.input.text);
        },
      },
    );
  };

  return {
    sending: submit.isPending || (sentTurnId !== null && !sentTurnShown),
    send,
    stop,
    stopping: cancel.isPending,
    error: submit.error ?? cancel.error,
    /** Forgets a failed Send once the player edits the text. */
    clearError: () => {
      if (submit.isError) submit.reset();
    },
  };
}
