// The inspector's routes (03-contracts §14.2, UI-090): a turn's model calls, and one
// call's whole record. Records live in the campaign's own database (ARCH-060).
import type { ModelCallRecord, ModelCallSummary } from '@mythos/contracts';
import type { FastifyInstance } from 'fastify';
import { listModelCalls, readModelCall, readTurn } from '../storage';
import type { HttpDeps } from './deps';
import { parseParams, sendError } from './errors';
import { CallParamsSchema, TurnParamsSchema } from './params';

/**
 * A record as the call list shows it: the time of every attempt together, and the
 * tokens the last attempt reported, null when it reported none.
 */
export function summaryOf(record: ModelCallRecord): ModelCallSummary {
  const last = record.attempts.at(-1);
  return {
    id: record.id,
    turnId: record.turnId,
    role: record.role,
    model: record.model,
    outcome: record.outcome,
    createdAt: record.createdAt,
    durationMs: record.attempts.reduce((total, attempt) => total + attempt.durationMs, 0),
    inputTokens: last?.usage?.inputTokens ?? null,
    outputTokens: last?.usage?.outputTokens ?? null,
    attempts: record.attempts.length,
  };
}

/** `GET …/turns/:turnId/model-calls` and `GET …/model-calls/:callId`. */
export function installInspectorRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const { store } = deps.turn;

  // Oldest first: storage lists them in the order they were written.
  fastify.get('/api/campaigns/:campaignId/turns/:turnId/model-calls', (request, reply) => {
    const params = parseParams(TurnParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const { campaignId, turnId } = params.value;
    const opened = store.openCampaign(campaignId);
    if (!opened.ok) return sendError(reply, opened.error);
    if (readTurn(opened.value, turnId) === null) {
      return sendError(reply, { code: 'not_found', message: `There is no turn ${turnId}.` });
    }
    return listModelCalls(opened.value, turnId).map(summaryOf);
  });

  fastify.get('/api/campaigns/:campaignId/model-calls/:callId', (request, reply) => {
    const params = parseParams(CallParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const { campaignId, callId } = params.value;
    const opened = store.openCampaign(campaignId);
    if (!opened.ok) return sendError(reply, opened.error);
    const record = readModelCall(opened.value, callId);
    if (record === null) {
      return sendError(reply, { code: 'not_found', message: `There is no model call ${callId}.` });
    }
    return record;
  });
}
