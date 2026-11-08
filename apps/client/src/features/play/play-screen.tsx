import { ArrowDownIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { useCampaign } from '@/api/campaigns';
import { useTurns } from '@/api/turns';
import { FailureMessage } from '@/components/failure-message';
import { StoryColumn } from '@/components/story-column';
import { Button } from '@/components/ui/button';
import { usePrefersReducedMotion } from '@/lib/use-media-query';
import { useDraft } from './draft';
import { InputDock } from './input-dock';
import { NarrationAnnouncer } from './narration-announcer';
import { Story } from './story';
import { headOf, inputAvailability, type InputAvailability } from './turn-status';
import { useStoryScroll } from './use-story-scroll';
import { useTurnCommands } from './use-turn-commands';

/**
 * Play (14-ui §5–7), at `/c/:campaignId`. The URL names no branch, so the story is the
 * campaign's current branch, which the campaign view gives (UI-001, TRN-101). Each
 * campaign gets its own state: its draft and its window of turns.
 */
export function PlayScreen() {
  const campaignId = useParams().campaignId ?? '';
  return <CampaignPlay key={campaignId} campaignId={campaignId} />;
}

function CampaignPlay({ campaignId }: { campaignId: string }) {
  const campaign = useCampaign(campaignId);
  if (!campaign.isSuccess) {
    return (
      <section className="py-8">
        <StoryColumn>
          {campaign.isError ? (
            <FailureMessage error={campaign.error} />
          ) : (
            <p className="font-interface text-text-muted">Opening the campaign…</p>
          )}
        </StoryColumn>
      </section>
    );
  }
  const { name, currentBranchId } = campaign.data;
  return <Playing campaignId={campaignId} branchId={currentBranchId} name={name} />;
}

type PlayingProps = { campaignId: string; branchId: string; name: string };

/**
 * The story above the input dock, which sticks to the bottom of the screen in the same
 * measure-wide column (UI-040, UI-043). The campaign's name is the page's heading for
 * screen readers; the shell's top bar shows it to everyone (14-ui Decisions).
 */
function Playing({ campaignId, branchId, name }: PlayingProps) {
  const turns = useTurns(campaignId, branchId);
  const reducedMotion = usePrefersReducedMotion();
  const [draft, setDraft] = useDraft(campaignId);
  const listed = turns.query.data;
  const shown = useMemo(
    () => (listed ?? []).filter((view) => view.turn.status !== 'abandoned'),
    [listed],
  );
  const head = headOf(listed ?? []);
  const commands = useTurnCommands({ campaignId, branchId, head, shown, setDraft });
  // A failed refetch leaves the story on screen, and the dock as it was.
  const availability: InputAvailability = turns.query.isLoadingError
    ? { available: false, reason: "The story couldn't be opened." }
    : inputAvailability(head, commands.sending);
  const last = shown.at(-1);
  const scroll = useStoryScroll({
    endKey: `${String(shown.length)}:${last?.turn.id ?? ''}:${String(last?.narration?.text.length ?? 0)}`,
    firstTurnId: shown[0]?.turn.id ?? null,
    onNearTop: turns.showEarlier,
  });

  return (
    <section data-branch-id={branchId} className="flex min-h-full flex-col">
      <h1 className="sr-only">{name}</h1>
      <div className="flex-1 py-6">
        <StoryColumn>
          {turns.query.isPending && (
            <p className="font-interface text-text-muted">Opening the story…</p>
          )}
          {turns.query.isError && <FailureMessage error={turns.query.error} />}
          {shown.length > 0 && (
            <Story
              campaignId={campaignId}
              branchId={branchId}
              turns={shown}
              hasEarlier={turns.hasEarlier}
              loadingEarlier={turns.loadingEarlier}
              onShowEarlier={turns.showEarlier}
              reducedMotion={reducedMotion}
              onInputReturned={setDraft}
            />
          )}
        </StoryColumn>
      </div>
      <StickyDock newTextBelow={scroll.newTextBelow} onShowNewText={scroll.showNewText}>
        <InputDock
          text={draft}
          onTextChange={(text) => {
            commands.clearError();
            setDraft(text);
          }}
          availability={availability}
          canStop={head?.turn.status === 'narrating' && !commands.sending}
          stopping={commands.stopping}
          onSend={commands.send}
          onStop={commands.stop}
          error={commands.error}
        />
      </StickyDock>
      <NarrationAnnouncer turns={shown} />
    </section>
  );
}

type StickyDockProps = { newTextBelow: boolean; onShowNewText: () => void; children: ReactNode };

/**
 * The dock's place: in the page's flow, sticking to the bottom of the screen, so it
 * stays above a phone's keyboard and never covers the story's end (UI-043). "New text
 * below" sits just above it (UI-053).
 */
function StickyDock({ newTextBelow, onShowNewText, children }: StickyDockProps) {
  return (
    <div
      data-dock
      className="sticky bottom-0 z-10 bg-background pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <StoryColumn>
        {newTextBelow && (
          <div className="flex justify-center pb-2">
            <Button variant="secondary" className="font-interface" onClick={onShowNewText}>
              <ArrowDownIcon aria-hidden />
              New text below
            </Button>
          </div>
        )}
        {children}
      </StoryColumn>
    </div>
  );
}
