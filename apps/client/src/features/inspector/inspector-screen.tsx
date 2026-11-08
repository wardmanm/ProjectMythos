import type { TurnView } from '@mythos/contracts';
import { ArrowLeftIcon } from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useModelCalls } from '@/api/model-calls';
import { useTurn } from '@/api/turns';
import { FailureMessage } from '@/components/failure-message';
import { CallDetail, INSPECTOR_TABS, type InspectorTab } from './call-detail';
import { CallList } from './call-list';

/** The address of a call and tab: `?call=<id>&tab=<tab>` (UI-001). */
function searchFor(callId: string, tab: InspectorTab): string {
  return `?${new URLSearchParams({ call: callId, tab }).toString()}`;
}

/**
 * The inspector (14-ui §9), at `/c/:campaignId/inspector/:turnId?call=&tab=`: every
 * model call of one turn, and the chosen call's Prompt and Output tabs. Read-only. The
 * chosen call and tab are in the address (UI-001); with no call named, the first is
 * shown, and with no tab, the Prompt tab. Implements UI-090.
 */
export function InspectorScreen() {
  const params = useParams();
  const campaignId = params.campaignId ?? '';
  const turnId = params.turnId ?? '';
  const [search, setSearch] = useSearchParams();
  const turn = useTurn(campaignId, turnId);
  const calls = useModelCalls(campaignId, turnId, turn.data?.turn.status ?? null);
  const tab = INSPECTOR_TABS.find((each) => each === search.get('tab')) ?? 'prompt';
  const chosenId = search.get('call') ?? calls.data?.[0]?.id ?? null;

  return (
    <section className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-4 px-4 py-6">
      <Link
        to={`/c/${encodeURIComponent(campaignId)}`}
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-md text-accent underline-offset-4 hover:underline"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Back to the story
      </Link>
      <h1 className="font-display text-2xl">Inspector</h1>
      {turn.isSuccess && <TurnContext view={turn.data} />}
      <section aria-labelledby="calls-heading" className="flex min-w-0 flex-col gap-2">
        <h2 id="calls-heading" className="font-display text-xl">
          Model calls
        </h2>
        {calls.isPending && <p className="text-text-muted">Opening the calls…</p>}
        {calls.isError && <FailureMessage error={calls.error} />}
        {calls.isSuccess && calls.data.length === 0 && (
          <p className="text-text-muted">This turn has no model calls yet.</p>
        )}
        {calls.isSuccess && calls.data.length > 0 && (
          <CallList
            calls={calls.data}
            chosenId={chosenId}
            searchFor={(callId) => searchFor(callId, tab)}
          />
        )}
      </section>
      {chosenId !== null && (
        <CallDetail
          campaignId={campaignId}
          callId={chosenId}
          tab={tab}
          onTabChange={(next) => {
            setSearch(searchFor(chosenId, next), { replace: true });
          }}
        />
      )}
    </section>
  );
}

/** Which turn this is: its date in game, and the player's input or that it is the opening. */
function TurnContext({ view }: { view: TurnView }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm text-text-muted">{view.gameTimeLabel}</p>
      {view.input === null ? (
        <p>The opening</p>
      ) : (
        <p className="font-narration whitespace-pre-line text-player-text wrap-break-word">
          {view.input.text}
        </p>
      )}
    </div>
  );
}
