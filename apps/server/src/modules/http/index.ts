// The http module's public API (ARCH-020): Fastify routes that map HTTP to module calls,
// with no game logic (ARCH-023). It may import every other module's public API
// (ARCH-021); the composition root builds what it calls and passes it in (ARCH-022).
import { fastifyCookie } from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { installCampaignRoutes } from './campaigns';
import type { HttpDeps } from './deps';
import { installErrorHandler } from './errors';
import { installEventRoutes } from './events';
import { installInspectorRoutes } from './inspector';
import { installLibraryRoutes } from './library';
import { installPinGate, installSessionRoutes } from './session';
import { installSettingsRoutes } from './settings';
import { installClient } from './static';
import { installTurnRoutes } from './turns';

export type { HttpDeps } from './deps';

/**
 * Installs the error handler, the cookie parser, the PIN gate, every route, and the
 * built client on `fastify`, in that order: the gate reads the parsed cookie, and the
 * client's not-found handler comes last. Every route is under `/api`. Implements ARCH-023
 * and ARCH-100.
 */
export async function installHttp(fastify: FastifyInstance, deps: HttpDeps): Promise<void> {
  installErrorHandler(fastify);
  await fastify.register(fastifyCookie);
  installPinGate(fastify, deps.auth);
  installSessionRoutes(fastify, deps);
  installLibraryRoutes(fastify, deps);
  installCampaignRoutes(fastify, deps);
  installTurnRoutes(fastify, deps);
  installEventRoutes(fastify, deps);
  installSettingsRoutes(fastify, deps);
  installInspectorRoutes(fastify, deps);
  await installClient(fastify, deps.clientDir);
}
