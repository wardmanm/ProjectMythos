// The inspector's hooks: a turn's model calls and one call's record (03-contracts §14.2).
import { ModelCallRecordSchema, ModelCallSummarySchema, type TurnStatus } from '@mythos/contracts';
import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { request } from './client';
import { queryKeys } from './query-keys';

const ModelCallListSchema = z.array(ModelCallSummarySchema);

/**
 * A turn's model calls, oldest first. A call's record is written when the call ends, so
 * the list is fetched again whenever the turn's status changes.
 */
export function useModelCalls(campaignId: string, turnId: string, status: TurnStatus | null) {
  const queryClient = useQueryClient();
  const seenStatus = useRef(status);
  useEffect(() => {
    if (seenStatus.current !== null && status !== seenStatus.current) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.modelCalls(campaignId, turnId) });
    }
    seenStatus.current = status;
  }, [queryClient, campaignId, turnId, status]);
  return useQuery({
    queryKey: queryKeys.modelCalls(campaignId, turnId),
    queryFn: ({ signal }) =>
      request(
        `/campaigns/${encodeURIComponent(campaignId)}/turns/${encodeURIComponent(turnId)}/model-calls`,
        ModelCallListSchema,
        { signal },
      ),
  });
}

/** One model call's whole record, once a call is chosen. */
export function useModelCall(campaignId: string, callId: string | null) {
  return useQuery({
    queryKey: queryKeys.modelCall(campaignId, callId ?? ''),
    queryFn:
      callId === null
        ? skipToken
        : ({ signal }) =>
            request(
              `/campaigns/${encodeURIComponent(campaignId)}/model-calls/${encodeURIComponent(callId)}`,
              ModelCallRecordSchema,
              { signal },
            ),
  });
}
