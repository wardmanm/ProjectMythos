// The library's routes (03-contracts §14.2): the packs to start a campaign from, and the
// themes a campaign can wear.
import type { FastifyInstance } from 'fastify';
import type { HttpDeps } from './deps';

/** `GET /api/packs` and `GET /api/themes`. */
export function installLibraryRoutes(fastify: FastifyInstance, deps: HttpDeps): void {
  const { content } = deps;

  // Packs with problems are listed too, with their issues (UI-083).
  fastify.get('/api/packs', () => content.listPacks());

  fastify.get('/api/themes', () => content.listThemes());
}
