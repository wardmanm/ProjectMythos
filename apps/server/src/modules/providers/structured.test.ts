import { ModelCallRecordSchema, type TierReport } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { MockOutcome } from './mock-outputs';
import { mockProviderError, mockResponse } from './mock-outputs';
import type { JobContext } from './queue';
import { flush } from './queue-testing';
import type { StructuredCallOptions } from './structured';
import { createCallSpace, emptyReport, testMessages } from './structured-testing';

const NoteSchema = z.strictObject({
  title: z.string().min(1).max(40),
  count: z.int().min(1),
});
type Note = z.infer<typeof NoteSchema>;

const space = createCallSpace();
afterEach(() => {
  space.cleanUp();
});

function answer(text: string, inputTokens = 0): MockOutcome {
  return { type: 'response', response: mockResponse(text, { usage: usageOf(inputTokens) }) };
}

function usageOf(inputTokens: number) {
  return { inputTokens, outputTokens: 5, cachedInputTokens: null };
}

function failure(code: Parameters<typeof mockProviderError>[0]): MockOutcome {
  return { type: 'error', error: mockProviderError(code) };
}

const valid = '{"title": "Rain", "count": 2}';
const tooSmall = '{"title": "", "count": 0}';

type Harness = Awaited<ReturnType<typeof space.calls>>;

function options(harness: Harness, overrides: Partial<StructuredCallOptions<Note>> = {}) {
  return {
    role: 'adjudicator' as const,
    schemaName: 'note',
    schema: NoteSchema,
    messages: testMessages,
    report: emptyReport,
    campaignId: harness.campaignId,
    turnId: null,
    signal: new AbortController().signal,
    job: null,
    ...overrides,
  };
}

describe('callStructured', () => {
  it('PRV-050: an answer in a code fence with trailing prose parses', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer('```json\n' + valid + '\n```\nThat is my ruling.'));
    const result = await harness.callStructured(options(harness));
    expect(result).toEqual({ ok: true, value: { title: 'Rain', count: 2 } });
    expect(harness.records().map((record) => record.outcome)).toEqual(['success']);
  });

  it('PRV-050: a schema error retries with the issues listed', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(tooSmall), answer(valid));
    const result = await harness.callStructured(options(harness));
    expect(result.ok).toBe(true);
    const retry = harness.mock.requests[1]?.messages ?? [];
    expect(retry.slice(-2, -1)).toEqual([{ role: 'assistant', content: tooSmall }]);
    const feedback = retry.at(-1)?.content ?? '';
    expect(feedback).toMatch(/^Your last answer could not be used:\n- title: .*\n- count: /);
  });

  it('PRV-050, PRV-054: a third failure returns model_output_invalid with every attempt', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(tooSmall), answer('no JSON'), answer(tooSmall));
    const result = await harness.callStructured(options(harness));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('model_output_invalid');
    const { attempts } = z
      .object({
        attempts: z.array(z.object({ attempt: z.int(), parseError: z.string().nullable() })),
      })
      .parse(result.error.details);
    expect(attempts.map((attempt) => attempt.attempt)).toEqual([1, 2, 3]);
    expect(attempts[1]?.parseError).toBe('The answer holds no JSON object.');
    expect(harness.mock.requests).toHaveLength(3);
    // Failed attempts are recorded, and the record parses when read back.
    const [record] = harness.records();
    expect(ModelCallRecordSchema.parse(record).outcome).toBe('failed');
    expect(record?.attempts.map((attempt) => attempt.schemaIssues.length > 0)).toEqual([
      true,
      false,
      true,
    ]);
    expect(record?.attempts.map((attempt) => attempt.rawOutput)).toEqual([
      tooSmall,
      'no JSON',
      tooSmall,
    ]);
  });

  it('PRV-053: provider_rejected on json-schema retries once as prompt-only, and the record shows it', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', failure('provider_rejected'), answer(valid));
    const result = await harness.callStructured(options(harness));
    expect(result).toEqual({ ok: true, value: { title: 'Rain', count: 2 } });
    const sentMethods = harness.mock.requests.map((request) => request.profile.structuredOutput);
    expect(sentMethods).toEqual(['json-schema', 'prompt-only']);
    expect(harness.mock.requests[1]?.messages[1]?.content).toContain('must match this JSON Schema');
    const [record] = harness.records();
    expect(record?.outcome).toBe('fallback');
    expect(record?.attempts.map((attempt) => attempt.method)).toEqual([
      'json-schema',
      'prompt-only',
    ]);
    expect(record?.attempts[0]?.error?.code).toBe('provider_rejected');
  });

  it('PRV-053: a rejection on prompt-only is returned, with no second switch', async () => {
    const harness = await space.calls({ profile: { structuredOutput: 'tool-call' } });
    harness.mock.script('adjudicator', failure('provider_rejected'), failure('provider_rejected'));
    const result = await harness.callStructured(options(harness));
    expect(!result.ok && result.error.code).toBe('provider_rejected');
    expect(harness.mock.requests).toHaveLength(2);
    expect(harness.records()[0]?.outcome).toBe('failed');
  });

  it('PRV-050: the format instruction is a system message after the system messages', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(valid));
    await harness.callStructured(options(harness));
    const sent = harness.mock.requests[0]?.messages ?? [];
    expect(sent.map((message) => message.role)).toEqual(['system', 'system', 'user']);
    expect(sent[1]?.content).toBe('Answer with a single JSON object for "note", and nothing else.');
    expect(harness.records()[0]?.messages).toEqual(sent);
  });

  it('PRV-052: an Anthropic profile is sent the adapted schema', async () => {
    const harness = await space.calls({ providerType: 'anthropic' });
    harness.mock.script('adjudicator', answer(valid));
    await harness.callStructured(options(harness));
    const format = harness.mock.requests[0]?.format;
    expect(format?.type === 'json' && format.jsonSchema.properties).toEqual({
      title: { type: 'string' },
      count: { type: 'integer' },
    });
  });

  it('PRV-050, CSET-050: a refusal fails the call as provider_rejected, with no retry', async () => {
    const harness = await space.calls();
    const refusal = mockResponse('I will not.', { finishReason: 'refusal' });
    harness.mock.script('adjudicator', { type: 'response', response: refusal });
    const result = await harness.callStructured(options(harness));
    expect(!result.ok && result.error.code).toBe('provider_rejected');
    expect(!result.ok && result.error.message).not.toContain('I will not');
    expect(harness.mock.requests).toHaveLength(1);
    expect(harness.records()[0]?.attempts[0]?.rawOutput).toBe('I will not.');
  });

  it('CONV-032: output that fails semanticCheck is never returned', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(valid), answer(valid), answer(valid));
    const result = await harness.callStructured(
      options(harness, { semanticCheck: () => [{ path: 'title', message: 'no such entity' }] }),
    );
    expect(!result.ok && result.error.code).toBe('model_output_invalid');
    const feedback = harness.mock.requests[1]?.messages.at(-1)?.content;
    expect(feedback).toContain('- title: no such entity');
  });

  it('PRV-051: a transient error is retried by the queue, apart from validation retries', async () => {
    const harness = await space.calls();
    harness.mock.script(
      'adjudicator',
      failure('provider_unavailable'),
      answer(tooSmall),
      answer(valid),
    );
    const pending = harness.callStructured(options(harness));
    await flush();
    harness.timer.advance(2000);
    const result = await pending;
    expect(result.ok).toBe(true);
    const [record] = harness.records();
    expect(record?.attempts.map((attempt) => attempt.error?.code ?? null)).toEqual([
      'provider_unavailable',
      null,
      null,
    ]);
    expect(harness.timer.delays).toEqual([2000]);
  });

  it('PRV-054, ARCH-060, ARCH-061: the record keeps the report and is stored outside the commits', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(valid));
    const tier: TierReport = {
      tier: 'task',
      budget: 100,
      estimatedTokens: 20,
      trimmed: [],
      cachedPrefix: false,
    };
    const report = { tiers: [tier], retrieved: [], templates: ['engine:adjudicator.md'] };
    await harness.callStructured(options(harness, { report }));
    const [record] = harness.records();
    expect(record).toMatchObject({
      role: 'adjudicator',
      providerId: 'mock',
      profileId: 'test-model',
      model: 'test-model-1',
      tiers: [tier],
      templates: ['engine:adjudicator.md'],
    });
    expect(harness.countRows('model_calls')).toBe(1);
    expect(harness.countRows('commit_sets')).toBe(0);
    expect(harness.countRows('commits')).toBe(0);
  });

  it('PRV-071: each answered attempt calibrates the profile with its estimate and reported tokens', async () => {
    const harness = await space.calls({ profile: { charsPerToken: 4 } });
    harness.mock.script('adjudicator', answer(tooSmall, 31), answer(valid, 47));
    await harness.callStructured(options(harness));
    const firstPrompt = harness.mock.requests[0]?.messages
      .map((message) => message.content)
      .join('');
    expect(harness.calibrated[0]).toEqual({
      profileId: 'test-model',
      estimated: Math.ceil((firstPrompt?.length ?? 0) / 4),
      reported: 31,
    });
    expect(harness.calibrated.map((call) => call.reported)).toEqual([31, 47]);
  });

  it('PRV-061: a signal aborted before the call cancels its job, and no request is sent', async () => {
    const harness = await space.calls();
    const controller = new AbortController();
    controller.abort();
    const result = await harness.callStructured(options(harness, { signal: controller.signal }));
    expect(!result.ok && result.error.code).toBe('cancelled');
    expect(harness.mock.requests).toHaveLength(0);
    expect(harness.jobs.map((job) => job.status)).toEqual(['queued', 'cancelled']);
    expect(harness.records()[0]).toMatchObject({ outcome: 'cancelled', attempts: [] });
  });

  it('PRV-067: with job null the call runs as an interactive job on the profile device', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(valid));
    await harness.callStructured(options(harness));
    expect(harness.jobs.map((job) => [job.type, job.deviceId, job.status])).toEqual([
      ['interactive', 'gpu', 'queued'],
      ['interactive', 'gpu', 'running'],
      ['interactive', 'gpu', 'succeeded'],
    ]);
  });

  it("PRV-067: a call given a JobContext runs in that job's slot, under its signal", async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(valid));
    const jobSignal = new AbortController();
    const job: JobContext = { jobId: 'background-job', attempt: 1, signal: jobSignal.signal };
    const result = await harness.callStructured(options(harness, { job }));
    expect(result.ok).toBe(true);
    expect(harness.jobs).toEqual([]);
    harness.mock.script('adjudicator', answer(valid));
    jobSignal.abort();
    const aborted = await harness.callStructured(options(harness, { job }));
    expect(!aborted.ok && aborted.error.code).toBe('cancelled');
  });

  it('PRV-001: a call for an unassigned role fails with not_configured and is not recorded', async () => {
    const harness = await space.calls({ roles: {} });
    const result = await harness.callStructured(options(harness));
    expect(!result.ok && result.error).toEqual({
      code: 'not_configured',
      message: 'No model is assigned to the adjudicator role. Choose one in Settings.',
    });
    expect(harness.records()).toEqual([]);
  });

  it('ARCH-060: a record whose campaign no longer opens is logged, and the result still returned', async () => {
    const harness = await space.calls();
    harness.mock.script('adjudicator', answer(valid));
    const missing = '00000000-0000-4000-8000-000000000000';
    const result = await harness.callStructured(options(harness, { campaignId: missing }));
    expect(result.ok).toBe(true);
    const logged = harness.logEntries.map(({ level, fields, message }) => [
      level,
      message,
      fields.campaignId,
      fields.code,
    ]);
    expect(logged).toEqual([['warn', 'a model call record was not stored', missing, 'not_found']]);
  });
});
