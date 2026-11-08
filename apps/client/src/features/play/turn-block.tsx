import type { TurnView } from '@mythos/contracts';
import { memo } from 'react';
import { Link } from 'react-router';
import { FailedTurn } from './failed-turn';
import { NarrationText } from './narration-text';
import { statusLine } from './turn-status';

type TurnBlockProps = {
  campaignId: string;
  branchId: string;
  view: TurnView;
  reducedMotion: boolean;
  /** Called with a cancelled turn's input, which goes back in the dock (TRN-047). */
  onInputReturned: (text: string) => void;
};

/**
 * One turn, in 14-ui §5.1's order: the player's input, the narration, the status line
 * while work is underway, and the failure card; then a quiet **Inspect** link (UI-090).
 * Memoized, so while one turn streams the others don't render again.
 */
export const TurnBlock = memo(function TurnBlock({
  campaignId,
  branchId,
  view,
  reducedMotion,
  onInputReturned,
}: TurnBlockProps) {
  const { turn, input, narration } = view;
  const narrating = turn.status === 'narrating';
  const line = statusLine[turn.status];
  return (
    <article data-turn-id={turn.id} className="flex min-w-0 flex-col gap-3">
      {input !== null && <PlayerInput mode={input.mode} text={input.text} />}
      {narration !== null && (
        <NarrationText text={narration.text} streaming={narrating} reducedMotion={reducedMotion} />
      )}
      {line !== null && <p className="font-interface text-sm text-text-muted">{line}</p>}
      {narration?.complete === false && !narrating && (
        <p className="font-interface text-sm text-text-muted">
          The narration stopped before the end.
        </p>
      )}
      {turn.status === 'stage-failed' && (
        <FailedTurn
          campaignId={campaignId}
          branchId={branchId}
          view={view}
          onInputReturned={onInputReturned}
        />
      )}
      <Link
        to={`/c/${encodeURIComponent(campaignId)}/inspector/${encodeURIComponent(turn.id)}`}
        className="inline-flex min-h-11 items-center self-start rounded-md font-interface text-sm text-text-muted underline-offset-4 hover:text-text hover:underline"
      >
        Inspect{' '}
        <span className="sr-only">
          {turn.parentTurnId === null ? 'the opening' : `turn ${String(turn.depth)}`}
        </span>
      </Link>
    </article>
  );
});

/**
 * Implements UI-050: in-character input in the narration face, in the player's color and
 * indented; out-of-character input in the interface face, muted, and marked as such.
 */
function PlayerInput({ mode, text }: { mode: 'ic' | 'ooc'; text: string }) {
  if (mode === 'ooc') {
    return (
      <div data-input="ooc" className="font-interface text-base text-text-muted">
        <p className="text-sm">Out of character</p>
        <p className="whitespace-pre-line wrap-break-word">{text}</p>
      </div>
    );
  }
  return (
    <p
      data-input="ic"
      className="pl-8 font-narration whitespace-pre-line text-player-text wrap-break-word"
    >
      {text}
    </p>
  );
}
