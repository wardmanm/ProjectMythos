import {
  BranchViewSchema,
  ErrorResponseSchema,
  SemanticIssueSchema,
  TurnViewSchema,
} from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mockProviderError, mockResponse } from '../providers';
import { createArrival, createHttpSpace, type HttpStack, settledTurn } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

const IssuesSchema = z.object({ issues: z.array(SemanticIssueSchema) });
const TurnIdSchema = z.object({ turnId: z.string() });

/** The reference campaign with its opening settled. */
async function opened(stack: HttpStack) {
  const view = await createArrival(stack);
  const opening = await settledTurn(stack, view.campaignId, view.headTurnId);
  return { ...view, opening, base: `/api/campaigns/${view.campaignId}` };
}

function errorOf(response: { json: () => unknown }) {
  return ErrorResponseSchema.parse(response.json()).error;
}

describe('turn routes', () => {
  it('TRN-130, ARCH-023: POST /actions returns the turn at once; its narration then commits', async () => {
    const stack = await space.stack();
    stack.mock.script(
      'narrator',
      { type: 'response', response: mockResponse('Rain on the quay.') },
      { type: 'response', response: mockResponse('She nods back.') },
    );
    const campaign = await opened(stack);
    const response = await stack.server.inject({
      method: 'POST',
      url: `${campaign.base}/actions`,
      payload: {
        branchId: campaign.currentBranchId,
        expectedHeadTurnId: campaign.headTurnId,
        mode: 'ic',
        text: 'I nod.',
      },
    });
    expect(response.statusCode).toBe(200);
    const { turnId } = TurnIdSchema.parse(response.json());

    const view = await settledTurn(stack, campaign.campaignId, turnId);
    expect(view.input).toEqual({ mode: 'ic', text: 'I nod.' });
    expect(view.narration).toEqual({ text: 'She nods back.', complete: true });
  });

  it('TRN-120: an action on a head that has moved is conflict', async () => {
    const stack = await space.stack();
    const campaign = await opened(stack);
    const response = await stack.server.inject({
      method: 'POST',
      url: `${campaign.base}/actions`,
      payload: {
        branchId: campaign.currentBranchId,
        expectedHeadTurnId: crypto.randomUUID(),
        mode: 'ic',
        text: 'I nod.',
      },
    });
    expect(response.statusCode).toBe(409);
    expect(errorOf(response).code).toBe('conflict');
  });

  it('ARCH-023: GET /branches and /branches/:branchId/turns page back from the head', async () => {
    const stack = await space.stack();
    const campaign = await opened(stack);
    const branches = await stack.server.inject({ url: `${campaign.base}/branches` });
    const [main] = z.array(BranchViewSchema).parse(branches.json());
    expect(main?.branch.headTurnId).toBe(campaign.headTurnId);
    expect(main?.isCurrent).toBe(true);

    const turns = await stack.server.inject({
      url: `${campaign.base}/branches/${campaign.currentBranchId}/turns`,
    });
    const views = z.array(TurnViewSchema).parse(turns.json());
    expect(views.map((view) => view.turn.id)).toEqual([campaign.headTurnId]);

    const before = await stack.server.inject({
      url: `${campaign.base}/branches/${campaign.currentBranchId}/turns?beforeDepth=0&limit=5`,
    });
    expect(before.json()).toEqual([]);
  });

  it('CON-091: a bad paging query is validation_failed at each parameter', async () => {
    const stack = await space.stack();
    const campaign = await opened(stack);
    const url = `${campaign.base}/branches/${campaign.currentBranchId}/turns?beforeDepth=-1&limit=0`;
    const response = await stack.server.inject({ url });
    expect(response.statusCode).toBe(400);
    const paths = IssuesSchema.parse(errorOf(response).details).issues.map((issue) => issue.path);
    expect(paths).toEqual(['beforeDepth', 'limit']);
  });

  it('TRN-052: a failed opening is retried through POST /turns/:turnId/regenerate', async () => {
    const stack = await space.stack();
    stack.mock.script(
      'narrator',
      { type: 'error', error: mockProviderError('provider_rejected') },
      { type: 'response', response: mockResponse('Fog lifts off the harbour.') },
    );
    const campaign = await opened(stack);
    expect(campaign.opening.turn.status).toBe('stage-failed');

    const response = await stack.server.inject({
      method: 'POST',
      url: `${campaign.base}/turns/${campaign.headTurnId}/regenerate`,
      payload: {
        branchId: campaign.currentBranchId,
        expectedHeadTurnId: campaign.headTurnId,
        turnId: campaign.headTurnId,
        stage: 'narration',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ turnId: campaign.headTurnId });
    const view = await settledTurn(stack, campaign.campaignId, campaign.headTurnId);
    expect(view.narration?.text).toBe('Fog lifts off the harbour.');
  });

  it('CON-091: a body turn that differs from the path turn is validation_failed at turnId', async () => {
    const stack = await space.stack();
    const campaign = await opened(stack);
    const other = crypto.randomUUID();
    for (const [action, extra] of [
      [
        'regenerate',
        { branchId: campaign.currentBranchId, expectedHeadTurnId: other, stage: 'narration' },
      ],
      ['cancel', {}],
    ] as const) {
      const response = await stack.server.inject({
        method: 'POST',
        url: `${campaign.base}/turns/${campaign.headTurnId}/${action}`,
        payload: { ...extra, turnId: other },
      });
      expect(response.statusCode, action).toBe(400);
      const issues = IssuesSchema.parse(errorOf(response).details).issues;
      expect(issues.map((issue) => issue.path)).toEqual(['turnId']);
    }
  });

  it('TRN-149: POST /turns/:turnId/cancel stops a narration and returns the turn', async () => {
    const stack = await space.stack({ mockDelayMs: 20 });
    stack.mock.script(
      'narrator',
      { type: 'response', response: mockResponse('Rain on the quay.') },
      { type: 'response', response: mockResponse('One two three four five six seven eight nine.') },
    );
    const campaign = await opened(stack);
    const submitted = await stack.server.inject({
      method: 'POST',
      url: `${campaign.base}/actions`,
      payload: {
        branchId: campaign.currentBranchId,
        expectedHeadTurnId: campaign.headTurnId,
        mode: 'ic',
        text: 'I wait.',
      },
    });
    const { turnId } = TurnIdSchema.parse(submitted.json());

    const response = await stack.server.inject({
      method: 'POST',
      url: `${campaign.base}/turns/${turnId}/cancel`,
      payload: { turnId },
    });
    expect(response.statusCode).toBe(200);
    const view = TurnViewSchema.parse(response.json());
    expect(view.turn.id).toBe(turnId);
    expect(['abandoned', 'complete']).toContain(view.turn.status);
    expect(view.input?.text).toBe('I wait.');
  });

  it('ARCH-104: an unknown turn, or a path ID that is not one, is not_found', async () => {
    const stack = await space.stack();
    const campaign = await opened(stack);
    for (const turnId of [crypto.randomUUID(), 'nope']) {
      const response = await stack.server.inject({ url: `${campaign.base}/turns/${turnId}` });
      expect(response.statusCode).toBe(404);
      expect(errorOf(response).code).toBe('not_found');
    }
  });
});
