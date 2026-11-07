// The machine settings routes (03-contracts §14.2, 05-providers §9): machine config with
// its secrets replaced (CON-111), the PIN, provider statuses, model lists, and the probe.
import { SetPinCommandSchema } from '@mythos/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { redact } from '../config';
import type { HttpDeps } from './deps';
import { parseParams, parseRequest, sendError } from './errors';
import { ProfileParamsSchema, ProviderParamsSchema } from './params';

/** A signal that aborts if the client goes away before its answer is sent. */
function abortedWhenClosed(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

/** Every route under `/api/settings`. */
export function installSettingsRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const { config, auth, health, probe } = deps;

  // Inline API keys and the PIN hash are replaced by the placeholder. A config that
  // failed to load answers with its `validation_failed`, listing every issue.
  // Implements CON-111.
  fastify.get('/api/settings', (_request, reply) => {
    const current = config.current();
    return current.ok ? redact(current.value) : sendError(reply, current.error);
  });

  // The body goes to `save` unparsed: placeholders must get their stored secrets back
  // before the schema sees them (CON-111), and `save` then parses it, listing every issue
  // (PRV-002), and writes it atomically. Implements PRV-003.
  fastify.put('/api/settings', async (request, reply) => {
    const saved = await config.save(request.body);
    return saved.ok ? saved.value : sendError(reply, saved.error);
  });

  // Any change to the PIN ends every session (01-architecture Decisions).
  fastify.put('/api/settings/pin', async (request, reply) => {
    const command = parseRequest(SetPinCommandSchema, request.body);
    if (!command.ok) return sendError(reply, command.error);
    const changed = await auth.setPin(command.value);
    return changed.ok ? reply.code(204).send() : sendError(reply, changed.error);
  });

  fastify.get('/api/settings/providers', async (_request, reply) => {
    const statuses = await health.statuses();
    return statuses.ok ? statuses.value : sendError(reply, statuses.error);
  });

  fastify.get('/api/settings/providers/:providerId/models', async (request, reply) => {
    const params = parseParams(ProviderParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const models = await deps.listModels(params.value.providerId, abortedWhenClosed(reply));
    return models.ok ? models.value : sendError(reply, models.error);
  });

  fastify.post('/api/settings/profiles/:profileId/probe', async (request, reply) => {
    const params = parseParams(ProfileParamsSchema, request.params, request.url);
    if (!params.ok) return sendError(reply, params.error);
    const result = await probe.probe(params.value.profileId, abortedWhenClosed(reply));
    return result.ok ? result.value : sendError(reply, result.error);
  });
}
