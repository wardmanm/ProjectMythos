// Implements UI-101 and ARCH-120: what each server event does to the query cache.
// Events either patch a cached turn or invalidate queries so they refetch; components
// only ever see the cache.
import type { ServerEventPayload, TurnView } from '@mythos/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { wordsForCode } from '@/api/plain-words';
import { campaignPrefixes, isCampaignKey, queryKeys } from '@/api/query-keys';
import type { Notice } from '@/stores/notice-store';
import { writeNarrationDelta } from './narration-delta';

export type EventContext = {
  queryClient: QueryClient;
  campaignId: string;
  /** Shows a notice in the shell, for an error that belongs to no turn. */
  notify: (notice: Notice) => void;
};

/** Applies one event for `context.campaignId` to the query cache. */
export function applyServerEvent(context: EventContext, payload: ServerEventPayload): void {
  const { queryClient, campaignId } = context;
  switch (payload.type) {
    case 'turn.status':
      patchTurn(context, payload.turnId, (view) => ({
        ...view,
        turn: { ...view.turn, status: payload.status },
      }));
      return;
    case 'resolution.ready':
      patchTurn(context, payload.draft.turnId, (view) => ({ ...view, draft: payload.draft }));
      return;
    case 'turn.created':
    case 'branch.changed':
      void queryClient.invalidateQueries({
        queryKey: queryKeys.turns(campaignId, payload.branchId),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaign(campaignId) });
      return;
    case 'narration.delta':
      applyNarrationDelta(context, payload.turnId, payload.offset, payload.text);
      return;
    case 'narration.done':
      refetchTurn(context, payload.turnId);
      return;
    case 'state.changed':
      void queryClient.invalidateQueries({ queryKey: campaignPrefixes.scene(campaignId) });
      for (const entityId of payload.affectedEntityIds) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.sheet(campaignId, entityId) });
      }
      void queryClient.invalidateQueries({ queryKey: campaignPrefixes.journal(campaignId) });
      return;
    case 'error':
      if (payload.turnId === null) {
        context.notify({ tone: 'failure', text: wordsForCode(payload.error.code) });
      } else {
        refetchTurn(context, payload.turnId);
      }
      return;
    case 'job.updated':
      // Phase 1 shows no job progress; the turn events cover what the player sees.
      return;
    case 'resync.required':
      resyncCampaign(queryClient, campaignId);
      return;
  }
}

/** Refetches everything cached for the campaign (UI-101, ARCH-091). */
export function resyncCampaign(queryClient: QueryClient, campaignId: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => isCampaignKey(query.queryKey, campaignId),
  });
}

/** Updates a turn wherever it is cached: on its own, and in each branch's list holding it. */
function patchTurn(context: EventContext, turnId: string, update: (view: TurnView) => TurnView) {
  const { queryClient, campaignId } = context;
  queryClient.setQueryData<TurnView>(queryKeys.turn(campaignId, turnId), (view) =>
    view === undefined ? undefined : update(view),
  );
  queryClient.setQueriesData<TurnView[]>({ queryKey: campaignPrefixes.turns(campaignId) }, (list) =>
    list?.map((view) => (view.turn.id === turnId ? update(view) : view)),
  );
}

/** Refetches a turn wherever it is cached. */
function refetchTurn(context: EventContext, turnId: string): void {
  const { queryClient, campaignId } = context;
  void queryClient.invalidateQueries({ queryKey: queryKeys.turn(campaignId, turnId) });
  const lists = queryClient.getQueriesData<TurnView[]>({
    queryKey: campaignPrefixes.turns(campaignId),
  });
  for (const [queryKey, list] of lists) {
    if (list?.some((view) => view.turn.id === turnId) === true) {
      void queryClient.invalidateQueries({ queryKey, exact: true });
    }
  }
}

/** Every cached copy of a turn: on its own, and in each branch's list holding it. */
function cachedTurns(context: EventContext, turnId: string): TurnView[] {
  const { queryClient, campaignId } = context;
  const single = queryClient.getQueryData<TurnView>(queryKeys.turn(campaignId, turnId));
  const lists = queryClient.getQueriesData<TurnView[]>({
    queryKey: campaignPrefixes.turns(campaignId),
  });
  const inLists = lists.flatMap(
    ([, list]) => list?.filter((view) => view.turn.id === turnId) ?? [],
  );
  return single === undefined ? inLists : [single, ...inLists];
}

/** Writes a delta into each cached copy of the turn that can take it; a gap in any refetches it. */
function applyNarrationDelta(context: EventContext, turnId: string, offset: number, text: string) {
  const written = (view: TurnView) =>
    writeNarrationDelta(view.narration?.text ?? null, offset, text);
  const gap = cachedTurns(context, turnId).some((view) => written(view) === null);
  patchTurn(context, turnId, (view) => {
    const narration = written(view);
    return narration === null ? view : { ...view, narration: { text: narration, complete: false } };
  });
  if (gap) refetchTurn(context, turnId);
}
