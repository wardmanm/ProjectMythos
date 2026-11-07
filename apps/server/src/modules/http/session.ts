// The PIN gate and the session routes (ARCH-110, CON-113). The auth module decides; this
// file only builds what it reads from each request and applies the cookie it returns.
import { PinLoginCommandSchema } from '@mythos/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Auth, type AuthRequest, SESSION_COOKIE_NAME, type SessionCookie } from '../auth';
import type { HttpDeps } from './deps';
import { parseRequest, sendError } from './errors';

/**
 * What the auth module reads from a request (auth README, "Wiring it in"): the matched
 * route pattern, never the raw URL, and the socket's address, never `request.ip`, which
 * follows `trustProxy` (01-architecture Decisions).
 */
export function authRequestOf(request: FastifyRequest): AuthRequest {
  return {
    method: request.method,
    routeUrl: request.routeOptions.url,
    remoteAddress: request.socket.remoteAddress,
    headers: request.headers,
    sessionToken: request.cookies[SESSION_COOKIE_NAME],
  };
}

function setCookie(reply: FastifyReply, cookie: SessionCookie): void {
  reply.setCookie(cookie.name, cookie.value, cookie.options);
}

/**
 * The PIN gate, run before every route. A request the lock refuses gets `401
 * auth_required`; one a session let in gets the cookie again, so the browser's expiry
 * slides with the session's. Implements ARCH-110 and CON-113.
 */
export function installPinGate(fastify: FastifyInstance, auth: Auth): void {
  fastify.addHook('onRequest', async (request, reply) => {
    const checked = auth.checkRequest(authRequestOf(request));
    if (!checked.ok) return sendError(reply, checked.error);
    if (checked.value !== null) setCookie(reply, checked.value);
  });
}

/** `GET`, `POST`, and `DELETE /api/session` (03-contracts §14.2). */
export function installSessionRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const { auth } = deps;

  fastify.get('/api/session', (request) => auth.sessionState(authRequestOf(request)));

  fastify.post('/api/session', async (request, reply) => {
    const command = parseRequest(PinLoginCommandSchema, request.body);
    if (!command.ok) return sendError(reply, command.error);
    const login = await auth.login(authRequestOf(request), command.value);
    if (!login.ok) return sendError(reply, login.error);
    if (login.value !== null) setCookie(reply, login.value);
    return reply.code(204).send();
  });

  fastify.delete('/api/session', (request, reply) => {
    setCookie(reply, auth.logout(request.cookies[SESSION_COOKIE_NAME]));
    return reply.code(204).send();
  });
}
