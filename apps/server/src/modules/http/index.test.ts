import { ErrorResponseSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpSpace } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

/** 03-contracts §14.2, then the phase-1 turn routes of 06-turn-engine §11. */
const SPEC_ROUTES = [
  'GET /api/session',
  'POST /api/session',
  'DELETE /api/session',
  'GET /api/packs',
  'GET /api/themes',
  'GET /api/campaigns',
  'POST /api/campaigns',
  'GET /api/campaigns/:campaignId',
  'DELETE /api/campaigns/:campaignId',
  'GET /api/campaigns/:campaignId/events',
  'GET /api/settings',
  'PUT /api/settings',
  'PUT /api/settings/pin',
  'GET /api/settings/providers',
  'GET /api/settings/providers/:providerId/models',
  'POST /api/settings/profiles/:profileId/probe',
  'GET /api/campaigns/:campaignId/turns/:turnId/model-calls',
  'GET /api/campaigns/:campaignId/model-calls/:callId',
  'POST /api/campaigns/:campaignId/actions',
  'POST /api/campaigns/:campaignId/turns/:turnId/regenerate',
  'POST /api/campaigns/:campaignId/turns/:turnId/cancel',
  'GET /api/campaigns/:campaignId/turns/:turnId',
  'GET /api/campaigns/:campaignId/branches',
  'GET /api/campaigns/:campaignId/branches/:branchId/turns',
];

describe('installHttp', () => {
  it('CON-110, ARCH-100: the server has exactly the routes the spec lists, all under /api', async () => {
    const stack = await space.stack();
    // Fastify adds a HEAD route for each GET by itself.
    const routes = stack.routes.filter((route) => !route.startsWith('HEAD '));
    expect([...routes].sort()).toEqual([...SPEC_ROUTES].sort());
  });

  it('CON-110: an unlisted /api route, or a listed one with another method, is not_found', async () => {
    const stack = await space.stack();
    for (const [method, url] of [
      ['GET', '/api/nope'],
      ['POST', '/api/packs'],
      ['GET', '/api'],
    ] as const) {
      const response = await stack.server.inject({ method, url });
      expect(response.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('not_found');
    }
  });
});
