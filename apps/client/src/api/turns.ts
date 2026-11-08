// The play screen's turn hooks: the routes of 06-turn-engine §10 that phase 1 has.
// Commands never write the cache; the server's events do (UI-102, ARCH-120).
import {
  CancelCommandSchema,
  IdSchema,
  RegenerateStageCommandSchema,
  SubmitActionCommandSchema,
  TurnViewSchema,
  type TurnView,
} from '@mythos/contracts';
import { keepPreviousData, skipToken, useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { request } from './client';
import { queryKeys } from './query-keys';

/** How many turns the play screen shows at first, and how many more each time the reader reaches the top. */
export const TURN_WINDOW = 50;

/** The most `GET /branches/:branchId/turns` returns at once (06-turn-engine Decisions). */
export const MAX_TURN_PAGE = 200;

/** What `POST /actions` and a narration's `regenerate` answer (06-turn-engine §10). */
const TurnStartedSchema = z.object({ turnId: IdSchema });

const TurnListSchema = z.array(TurnViewSchema);

function campaignPath(campaignId: string): string {
  return `/campaigns/${encodeURIComponent(campaignId)}`;
}

/**
 * The newest `count` turns on a branch, oldest first. The server sends at most 200 at a
 * time, so a bigger window is read in pages back from the head, each ending below the
 * oldest turn so far. Implements UI-100.
 */
export async function fetchNewestTurns(
  campaignId: string,
  branchId: string,
  count: number,
  signal?: AbortSignal,
): Promise<TurnView[]> {
  const path = `${campaignPath(campaignId)}/branches/${encodeURIComponent(branchId)}/turns`;
  let turns: TurnView[] = [];
  while (turns.length < count) {
    const limit = Math.min(count - turns.length, MAX_TURN_PAGE);
    const oldest = turns[0];
    const query =
      oldest === undefined
        ? `?limit=${String(limit)}`
        : `?beforeDepth=${String(oldest.turn.depth)}&limit=${String(limit)}`;
    const options = signal === undefined ? {} : { signal };
    const page = await request(path + query, TurnListSchema, options);
    turns = [...page, ...turns];
    // A short page has reached the branch's first turn.
    if (page.length < limit || turns[0]?.turn.depth === 0) break;
  }
  return turns;
}

/**
 * The play screen's window of a branch's turns: the newest 50, and 50 more each time
 * `showEarlier` is called. While a bigger window loads, the smaller one stays on screen.
 */
export function useTurns(campaignId: string, branchId: string) {
  const [count, setCount] = useState(TURN_WINDOW);
  const query = useQuery({
    queryKey: queryKeys.turnsNewest(campaignId, branchId, count),
    queryFn: ({ signal }) => fetchNewestTurns(campaignId, branchId, count, signal),
    placeholderData: keepPreviousData,
  });
  const oldest = query.data?.[0];
  const hasEarlier = oldest !== undefined && oldest.turn.depth > 0;
  const loadingEarlier = query.isPlaceholderData;
  const showEarlier = useCallback(() => {
    if (hasEarlier && !loadingEarlier) setCount((shown) => shown + TURN_WINDOW);
  }, [hasEarlier, loadingEarlier]);
  return { query, hasEarlier, loadingEarlier, showEarlier };
}

/** One turn: `GET /turns/:turnId`, once its ID is known. */
export function useTurn(campaignId: string, turnId: string | null) {
  return useQuery({
    queryKey: queryKeys.turn(campaignId, turnId ?? ''),
    queryFn:
      turnId === null
        ? skipToken
        : ({ signal }) =>
            request(
              `${campaignPath(campaignId)}/turns/${encodeURIComponent(turnId)}`,
              TurnViewSchema,
              {
                signal,
              },
            ),
  });
}

/** `POST /actions`: answers the new turn's ID; the turn itself arrives as events (TRN-130). */
export function useSubmitAction(campaignId: string) {
  return useMutation({
    mutationFn: (command: z.input<typeof SubmitActionCommandSchema>) =>
      request(`${campaignPath(campaignId)}/actions`, TurnStartedSchema, {
        method: 'POST',
        body: command,
      }),
  });
}

/**
 * `POST /turns/:turnId/cancel`: Stop while narrating, or cancel a failed turn. Answers
 * the turn's view afterwards; an abandoned one holds its input (TRN-047, TRN-149).
 */
export function useCancelTurn(campaignId: string) {
  return useMutation({
    mutationFn: (command: z.input<typeof CancelCommandSchema>) =>
      request(
        `${campaignPath(campaignId)}/turns/${encodeURIComponent(command.turnId)}/cancel`,
        TurnViewSchema,
        { method: 'POST', body: command },
      ),
  });
}

/** `POST /turns/:turnId/regenerate` for a failed narration, the head turn (TRN-052). */
export function useRetryNarration(campaignId: string) {
  return useMutation({
    mutationFn: ({ branchId, turnId }: { branchId: string; turnId: string }) => {
      const command: z.input<typeof RegenerateStageCommandSchema> = {
        branchId,
        expectedHeadTurnId: turnId,
        turnId,
        stage: 'narration',
      };
      return request(
        `${campaignPath(campaignId)}/turns/${encodeURIComponent(turnId)}/regenerate`,
        TurnStartedSchema,
        { method: 'POST', body: command },
      );
    },
  });
}
