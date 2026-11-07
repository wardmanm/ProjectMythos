import { randomUUID } from 'node:crypto';
import {
  type ModelCallAttempt,
  type ModelCallRecord,
  ModelCallRecordSchema,
  ModelCallSummarySchema,
} from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { summaryOf } from './inspector';
import { createArrival, createHttpSpace, settledTurn } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

function attempt(overrides: Partial<ModelCallAttempt>): ModelCallAttempt {
  return {
    attempt: 1,
    method: 'text',
    rawOutput: '',
    thinking: null,
    error: null,
    parseError: null,
    schemaIssues: [],
    semanticIssues: [],
    usage: null,
    durationMs: 0,
    ...overrides,
  };
}

function record(attempts: ModelCallAttempt[]): ModelCallRecord {
  return {
    id: randomUUID(),
    campaignId: randomUUID(),
    turnId: randomUUID(),
    role: 'narrator',
    providerId: 'mock',
    profileId: 'mock-narrator',
    model: 'mock-1',
    messages: [],
    tiers: [],
    retrieved: [],
    templates: [],
    attempts,
    outcome: 'success',
    createdAt: '2026-11-07T12:00:00.000Z',
  };
}

describe('summaryOf', () => {
  it('UI-090: the time is every attempt together, and the tokens are the last attempt’s', () => {
    const summary = summaryOf(
      record([
        attempt({
          attempt: 1,
          durationMs: 400,
          error: { code: 'provider_timeout', message: 'Slow.' },
        }),
        attempt({
          attempt: 2,
          durationMs: 250,
          usage: { inputTokens: 900, outputTokens: 120, cachedInputTokens: null },
        }),
      ]),
    );
    expect(ModelCallSummarySchema.parse(summary)).toMatchObject({
      durationMs: 650,
      inputTokens: 900,
      outputTokens: 120,
      attempts: 2,
    });
  });

  it('UI-090: tokens the last attempt did not report are null', () => {
    const summary = summaryOf(record([attempt({ durationMs: 10 })]));
    expect(summary).toMatchObject({ inputTokens: null, outputTokens: null, attempts: 1 });
  });
});

describe('inspector routes', () => {
  it('ARCH-060: a turn’s model calls are listed as summaries, and each opens as its record', async () => {
    const stack = await space.stack();
    const view = await createArrival(stack);
    await settledTurn(stack, view.campaignId, view.headTurnId);
    const base = `/api/campaigns/${view.campaignId}`;

    const list = await stack.server.inject({ url: `${base}/turns/${view.headTurnId}/model-calls` });
    expect(list.statusCode).toBe(200);
    const summaries = z.array(ModelCallSummarySchema.strict()).parse(list.json());
    expect(summaries.map((summary) => [summary.role, summary.outcome])).toEqual([
      ['narrator', 'success'],
    ]);

    const [summary] = summaries;
    if (summary === undefined) throw new Error('no model call was recorded');
    const one = await stack.server.inject({ url: `${base}/model-calls/${summary.id}` });
    const full = ModelCallRecordSchema.parse(one.json());
    expect(full.turnId).toBe(view.headTurnId);
    expect(full.messages.length).toBeGreaterThan(0);
  });

  it('ARCH-104: an unknown turn or model call is not_found', async () => {
    const stack = await space.stack();
    const view = await createArrival(stack);
    await settledTurn(stack, view.campaignId, view.headTurnId);
    const base = `/api/campaigns/${view.campaignId}`;
    for (const url of [
      `${base}/turns/${randomUUID()}/model-calls`,
      `${base}/model-calls/${randomUUID()}`,
    ]) {
      expect((await stack.server.inject({ url })).statusCode).toBe(404);
    }
  });
});
