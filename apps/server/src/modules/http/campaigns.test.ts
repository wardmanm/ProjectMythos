import { randomUUID } from 'node:crypto';
import {
  CampaignSummarySchema,
  CampaignViewSchema,
  ErrorResponseSchema,
  SemanticIssueSchema,
} from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { arrivalCommand, createArrival, createHttpSpace, settledTurn } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

const IssuesSchema = z.object({ issues: z.array(SemanticIssueSchema) });

describe('campaign routes', () => {
  it('CON-112: POST /campaigns reports every problem at once, and writes nothing', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: arrivalCommand({ scenarioId: 'scenario.nowhere', toneProfileId: 'tone.none' }),
    });
    expect(response.statusCode).toBe(400);
    const { error } = ErrorResponseSchema.parse(response.json());
    expect(error.code).toBe('validation_failed');
    const paths = IssuesSchema.parse(error.details).issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['scenarioId', 'toneProfileId']));

    const list = await stack.server.inject({ url: '/api/campaigns' });
    expect(list.json()).toEqual([]);
  });

  it('ARCH-023, CON-091: a command the contract rejects lists every issue at its path', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({
      method: 'POST',
      url: '/api/campaigns',
      payload: { name: '', packId: 'reference' },
    });
    expect(response.statusCode).toBe(400);
    const { error } = ErrorResponseSchema.parse(response.json());
    const paths = IssuesSchema.parse(error.details).issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['name', 'scenarioId', 'toneProfileId']));
  });

  it('CON-112: POST /campaigns returns the view while the opening narration still runs', async () => {
    const stack = await space.stack({ mockDelayMs: 20 });
    const view = await createArrival(stack);
    expect(stack.narrations.inFlight(view.campaignId)).toBe(true);
    const opening = await settledTurn(stack, view.campaignId, view.headTurnId);
    expect(opening.turn.status).toBe('complete');
  });

  it('ARCH-023: GET /campaigns and GET /campaigns/:campaignId read what was created', async () => {
    const stack = await space.stack();
    const view = await createArrival(stack);
    await settledTurn(stack, view.campaignId, view.headTurnId);

    const list = await stack.server.inject({ url: '/api/campaigns' });
    const summaries = z.array(CampaignSummarySchema).parse(list.json());
    expect(summaries.map((summary) => summary.campaignId)).toEqual([view.campaignId]);

    const one = await stack.server.inject({ url: `/api/campaigns/${view.campaignId}` });
    expect(CampaignViewSchema.parse(one.json())).toEqual(view);
  });

  it('ARCH-104: an unknown campaign, or an ID that is not one, is not_found', async () => {
    const stack = await space.stack();
    for (const id of [randomUUID(), 'not-an-id']) {
      const response = await stack.server.inject({ url: `/api/campaigns/${id}` });
      expect(response.statusCode).toBe(404);
      expect(ErrorResponseSchema.parse(response.json()).error.code).toBe('not_found');
    }
  });

  it('ARCH-023: DELETE /campaigns/:campaignId refuses while it narrates, then deletes it', async () => {
    const stack = await space.stack({ mockDelayMs: 20 });
    const view = await createArrival(stack);
    const url = `/api/campaigns/${view.campaignId}`;

    // Owner decision (03-contracts Decisions): a running narration would reopen the database.
    const refused = await stack.server.inject({ method: 'DELETE', url });
    expect(refused.statusCode).toBe(409);
    expect(ErrorResponseSchema.parse(refused.json()).error.code).toBe('turn_in_progress');

    await settledTurn(stack, view.campaignId, view.headTurnId);
    const deleted = await stack.server.inject({ method: 'DELETE', url });
    expect(deleted.statusCode).toBe(204);
    expect((await stack.server.inject({ url })).statusCode).toBe(404);
  });
});
