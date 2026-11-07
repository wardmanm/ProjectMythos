// Phase 1's turn routes (06-turn-engine §10 and §11): submit an action, retry a failed
// narration, Stop, and read turns and branches. Each route parses its input, calls one
// turn-module function, and maps the result (ARCH-023).
import {
  type AppError,
  CancelCommandSchema,
  RegenerateStageCommandSchema,
  SubmitActionCommandSchema,
} from '@mythos/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  branchViews,
  cancelTurn,
  regenerateStage,
  submitAction,
  turnView,
  turnViews,
} from '../turn';
import type { HttpDeps } from './deps';
import { parseParams, parseRequest, sendError, validationFailed } from './errors';
import { BranchParamsSchema, CampaignParamsSchema, TurnParamsSchema } from './params';

/** How many turns `GET /branches/:branchId/turns` returns when no `limit` is given, and at most. */
export const TURN_PAGE = { defaultLimit: 50, maxLimit: 200 };

/** A query value written in decimal digits, from `min` to `max`. */
function wholeNumber(min: number, max: number) {
  return z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.int().min(min).max(max));
}

/** `?beforeDepth=&limit=`: turns below a depth (else up to the head), at most `limit`. */
const TurnPageQuerySchema = z.object({
  beforeDepth: wholeNumber(0, Number.MAX_SAFE_INTEGER).optional(),
  limit: wholeNumber(1, TURN_PAGE.maxLimit).default(TURN_PAGE.defaultLimit),
});

/** 06-turn-engine §10: "Path IDs must match body IDs." */
function differentTurn(pathTurnId: string, bodyTurnId: string): AppError | null {
  if (pathTurnId === bodyTurnId) return null;
  return validationFailed([
    { path: 'turnId', message: `must be the turn in the path, ${pathTurnId}` },
  ]);
}

/** The phase-1 routes under `/api/campaigns/:campaignId`. */
export function installTurnRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const turn = deps.turn;
  const views = { store: turn.store, narrations: turn.narrations };

  // Returns `{ turnId }` once the turn is stored; its narration arrives as events (TRN-130).
  fastify.post('/api/campaigns/:campaignId/actions', (request, reply) => {
    const params = parseParams(CampaignParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const command = parseRequest(SubmitActionCommandSchema, request.body);
    if (!command.ok) return sendError(reply, command.error);
    const submitted = submitAction(turn, params.value.campaignId, command.value);
    return submitted.ok ? submitted.value : sendError(reply, submitted.error);
  });

  // Phase 1 retries a failed narration only (06-turn-engine §11).
  fastify.post('/api/campaigns/:campaignId/turns/:turnId/regenerate', (request, reply) => {
    const params = parseParams(TurnParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const command = parseRequest(RegenerateStageCommandSchema, request.body);
    if (!command.ok) return sendError(reply, command.error);
    const mismatch = differentTurn(params.value.turnId, command.value.turnId);
    if (mismatch !== null) return sendError(reply, mismatch);
    const started = regenerateStage(turn, params.value.campaignId, command.value);
    return started.ok ? started.value : sendError(reply, started.error);
  });

  // The player's Stop (TRN-149): returns the turn's view once things have settled.
  fastify.post('/api/campaigns/:campaignId/turns/:turnId/cancel', async (request, reply) => {
    const params = parseParams(TurnParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const command = parseRequest(CancelCommandSchema, request.body);
    if (!command.ok) return sendError(reply, command.error);
    const mismatch = differentTurn(params.value.turnId, command.value.turnId);
    if (mismatch !== null) return sendError(reply, mismatch);
    const cancelled = await cancelTurn(turn, params.value.campaignId, command.value);
    return cancelled.ok ? cancelled.value : sendError(reply, cancelled.error);
  });

  fastify.get('/api/campaigns/:campaignId/turns/:turnId', (request, reply) => {
    const params = parseParams(TurnParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const view = turnView(views, params.value.campaignId, params.value.turnId);
    return view.ok ? view.value : sendError(reply, view.error);
  });

  fastify.get('/api/campaigns/:campaignId/branches', (request, reply) => {
    const params = parseParams(CampaignParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const branches = branchViews(turn.store, params.value.campaignId);
    return branches.ok ? branches.value : sendError(reply, branches.error);
  });

  // Oldest first, paging back from the head.
  fastify.get('/api/campaigns/:campaignId/branches/:branchId/turns', (request, reply) => {
    const params = parseParams(BranchParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const query = parseRequest(TurnPageQuerySchema, request.query);
    if (!query.ok) return sendError(reply, query.error);
    const page = { beforeDepth: query.value.beforeDepth ?? null, limit: query.value.limit };
    const { campaignId, branchId } = params.value;
    const turns = turnViews(views, campaignId, branchId, page);
    return turns.ok ? turns.value : sendError(reply, turns.error);
  });
}
