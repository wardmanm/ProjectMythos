// The campaign routes (03-contracts §14.2): list, create, open, and delete.
import { type AppError, CreateCampaignCommandSchema } from '@mythos/contracts';
import type { FastifyInstance } from 'fastify';
import { campaignView, createCampaign, listCampaignSummaries } from '../turn';
import type { HttpDeps } from './deps';
import { parseParams, parseRequest, sendError } from './errors';
import { CampaignParamsSchema } from './params';

const narrationRunning: AppError = {
  code: 'turn_in_progress',
  message: 'This campaign is still narrating. Stop the narration or let it finish, then delete it.',
};

/** `GET` and `POST /api/campaigns`, and `GET` and `DELETE /api/campaigns/:campaignId`. */
export function installCampaignRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const { store, timeSource, newId, logger, narrations } = deps.turn;

  // Most recently played first.
  fastify.get('/api/campaigns', () => listCampaignSummaries(store));

  // Every problem with the command is reported at once, and the response does not wait
  // for the opening narration, which streams as events. Implements CON-112.
  fastify.post('/api/campaigns', async (request, reply) => {
    const command = parseRequest(CreateCampaignCommandSchema, request.body);
    if (!command.ok) return sendError(reply, command.error);
    const created = await createCampaign(
      { store, content: deps.content, timeSource, newId, logger, narrations },
      command.value,
    );
    return created.ok ? created.value : sendError(reply, created.error);
  });

  fastify.get('/api/campaigns/:campaignId', (request, reply) => {
    const params = parseParams(CampaignParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const view = campaignView(store, params.value.campaignId);
    return view.ok ? view.value : sendError(reply, view.error);
  });

  // While a narration of the campaign runs, nothing is deleted: the narration would
  // reopen the database as its folder went (owner decision, 03-contracts Decisions).
  fastify.delete('/api/campaigns/:campaignId', async (request, reply) => {
    const params = parseParams(CampaignParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const { campaignId } = params.value;
    if (narrations.inFlight(campaignId)) return sendError(reply, narrationRunning);
    const deleted = await store.deleteCampaign(campaignId);
    return deleted.ok ? reply.code(204).send() : sendError(reply, deleted.error);
  });
}
