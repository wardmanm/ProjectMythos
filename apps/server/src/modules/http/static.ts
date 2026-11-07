// The built client, served from `/` on the API's port (ARCH-102), and what every request
// no route matched gets: `not_found` under `/api` (CON-110), and outside it the client's
// `index.html`, so a client route such as `/c/:campaignId` opens the app at that screen.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fastifyStatic } from '@fastify/static';
import type { AppError } from '@mythos/contracts';
import type { FastifyInstance } from 'fastify';
import { sendError } from './errors';

function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Whether a path names a file, such as `/assets/index-3f2a.js`: its last segment has a
 * dot. Client routes never do, and a missing file must never get `index.html` instead.
 */
function looksLikeFile(pathname: string): boolean {
  return pathname.slice(pathname.lastIndexOf('/') + 1).includes('.');
}

const NOT_BUILT: AppError = {
  code: 'not_found',
  message: 'The client is not built. Run pnpm build, then start Mythos again.',
};

/**
 * Serves `clientDir` and installs the not-found handler. A folder with no `index.html`,
 * or none at all, serves the API alone, with a warning. Implements ARCH-102 and CON-110.
 */
export async function installClient(
  fastify: FastifyInstance,
  clientDir: string | null,
): Promise<void> {
  const built = clientDir !== null && existsSync(path.join(clientDir, 'index.html'));
  if (built) {
    await fastify.register(fastifyStatic, { root: clientDir });
  } else {
    fastify.log.warn({ clientDir }, 'the client is not built, so only the API is served');
  }

  fastify.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?', 1)[0] ?? request.url;
    const api = isApiPath(pathname);
    if (!api && !built) return sendError(reply, NOT_BUILT);
    const page = request.method === 'GET' || request.method === 'HEAD';
    if (!api && page && !looksLikeFile(pathname)) return reply.sendFile('index.html');
    return sendError(reply, { code: 'not_found', message: `Nothing is at ${pathname}.` });
  });
}
