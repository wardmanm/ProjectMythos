import type { TurnView } from '@mythos/contracts';
import { Button } from '@/components/ui/button';
import { TurnBlock } from './turn-block';

type StoryProps = {
  campaignId: string;
  branchId: string;
  /** The turns to show, oldest first, abandoned ones already left out. */
  turns: readonly TurnView[];
  hasEarlier: boolean;
  loadingEarlier: boolean;
  onShowEarlier: () => void;
  reducedMotion: boolean;
  onInputReturned: (text: string) => void;
};

/**
 * The story: every turn on the branch, oldest first, newest last. Earlier turns load as
 * the reader nears the top, or with **Show earlier turns** from the keyboard. The story
 * has no live region of its own (UI-112), and `overflow-anchor: none`, because the play
 * screen keeps the reader's place itself when earlier turns arrive (UI-043).
 */
export function Story(props: StoryProps) {
  const { campaignId, branchId, turns, hasEarlier, loadingEarlier, onShowEarlier } = props;
  return (
    <div data-story className="flex flex-col gap-8 [overflow-anchor:none]">
      {hasEarlier && (
        <Button
          variant="ghost"
          className="self-center font-interface"
          disabled={loadingEarlier}
          onClick={onShowEarlier}
        >
          {loadingEarlier ? 'Loading earlier turns…' : 'Show earlier turns'}
        </Button>
      )}
      {turns.map((view) => (
        <TurnBlock
          key={view.turn.id}
          campaignId={campaignId}
          branchId={branchId}
          view={view}
          reducedMotion={props.reducedMotion}
          onInputReturned={props.onInputReturned}
        />
      ))}
    </div>
  );
}
