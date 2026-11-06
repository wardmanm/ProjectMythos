import { afterEach, describe, expect, it } from 'vitest';
import { type MockOutcome, mockProviderError, mockResponse } from './mock-outputs';
import { flush } from './queue-testing';
import type { StreamTextOptions } from './structured';
import { createCallSpace, emptyReport, testMessages } from './structured-testing';

const space = createCallSpace();
afterEach(() => {
  space.cleanUp();
});

type Harness = Awaited<ReturnType<typeof space.calls>>;

const narration = 'Rain needles the shutters while the lamps burn low.';

function answer(text: string, overrides: Parameters<typeof mockResponse>[1] = {}): MockOutcome {
  return { type: 'response', response: mockResponse(text, overrides) };
}

/** Options for a narrator call whose deltas land in `deltas`. */
function options(harness: Harness, overrides: Partial<StreamTextOptions> = {}) {
  const deltas: string[] = [];
  const streamOptions: StreamTextOptions = {
    role: 'narrator',
    messages: testMessages,
    report: emptyReport,
    campaignId: harness.campaignId,
    turnId: null,
    signal: new AbortController().signal,
    onDelta: (delta) => deltas.push(delta),
    job: null,
    ...overrides,
  };
  return { streamOptions, deltas };
}

describe('streamText', () => {
  it('PRV-045: a streaming profile forwards each delta as it arrives', async () => {
    const harness = await space.calls();
    harness.mock.script('narrator', answer(narration));
    const { streamOptions, deltas } = options(harness);
    const result = await harness.streamText(streamOptions);
    expect(result).toEqual({ ok: true, value: { text: narration, finishReason: 'stop' } });
    expect(deltas.length).toBeGreaterThan(5);
    expect(deltas.join('')).toBe(narration);
    const [record] = harness.records();
    expect(record).toMatchObject({ role: 'narrator', outcome: 'success', messages: testMessages });
    expect(record?.attempts.map((attempt) => [attempt.method, attempt.rawOutput])).toEqual([
      ['text', narration],
    ]);
  });

  it('PRV-045: a profile with streaming off gets the whole text as one delta', async () => {
    const harness = await space.calls({ profile: { streaming: false } });
    harness.mock.script('narrator', answer(narration));
    const { streamOptions, deltas } = options(harness);
    await harness.streamText(streamOptions);
    expect(harness.mock.requests[0]?.onDelta).toBeUndefined();
    expect(deltas).toEqual([narration]);
  });

  it('PRV-046: thinking never reaches onDelta, and is kept in the record', async () => {
    const harness = await space.calls();
    harness.mock.script('narrator', answer(narration, { thinking: 'The player wants mood.' }));
    const { streamOptions, deltas } = options(harness);
    const result = await harness.streamText(streamOptions);
    expect(result.ok && result.value.text).toBe(narration);
    expect(deltas.join('')).toBe(narration);
    expect(harness.records()[0]?.attempts[0]?.thinking).toBe('The player wants mood.');
  });

  it('PRV-047, PRV-061: aborting the signal cancels the job and keeps the text so far', async () => {
    const harness = await space.calls();
    harness.mock.script(
      'narrator',
      answer(narration, { usage: { inputTokens: 40, outputTokens: 9, cachedInputTokens: null } }),
    );
    const controller = new AbortController();
    const { streamOptions, deltas } = options(harness, { signal: controller.signal });
    const onDelta = streamOptions.onDelta;
    streamOptions.onDelta = (delta) => {
      onDelta(delta);
      if (deltas.length === 2) controller.abort();
    };
    const result = await harness.streamText(streamOptions);
    expect(result).toEqual({
      ok: true,
      value: { text: 'Rain needles ', finishReason: 'cancelled' },
    });
    expect(harness.jobs.at(-1)?.status).toBe('cancelled');
    expect(harness.records()[0]?.outcome).toBe('cancelled');
    // PRV-071: a cancelled call's usage is an estimate, so it is not calibrated.
    expect(harness.calibrated).toEqual([]);
  });

  it('PRV-047: an abort before any text is the cancelled error', async () => {
    const harness = await space.calls();
    const controller = new AbortController();
    controller.abort();
    const { streamOptions, deltas } = options(harness, { signal: controller.signal });
    const result = await harness.streamText(streamOptions);
    expect(!result.ok && result.error.code).toBe('cancelled');
    expect(deltas).toEqual([]);
    expect(harness.records()[0]?.outcome).toBe('cancelled');
  });

  it('PRV-051, PRV-047: an error after text has streamed is not retried', async () => {
    const harness = await space.calls();
    const error = mockProviderError('provider_unavailable');
    harness.mock.script(
      'narrator',
      { type: 'error', error, partialText: 'Rain needles ' },
      answer(narration),
    );
    const { streamOptions, deltas } = options(harness);
    const result = await harness.streamText(streamOptions);
    expect(result).toEqual({ ok: false, error: { ...error, retryable: false } });
    expect(deltas.join('')).toBe('Rain needles ');
    expect(harness.mock.requests).toHaveLength(1);
    expect(harness.timer.delays).toEqual([]);
    const [record] = harness.records();
    expect(record?.outcome).toBe('failed');
    expect(record?.attempts[0]?.error).toEqual({
      code: 'provider_unavailable',
      message: error.message,
    });
  });

  it('PRV-051: an error before any text is retried by the queue', async () => {
    const harness = await space.calls();
    harness.mock.script(
      'narrator',
      { type: 'error', error: mockProviderError('provider_timeout') },
      answer(narration),
    );
    const { streamOptions, deltas } = options(harness);
    const pending = harness.streamText(streamOptions);
    await flush();
    harness.timer.advance(2000);
    const result = await pending;
    expect(result.ok && result.value.text).toBe(narration);
    expect(deltas.join('')).toBe(narration);
    expect(
      harness.records()[0]?.attempts.map((attempt) => attempt.error?.code ?? 'answered'),
    ).toEqual(['provider_timeout', 'answered']);
  });

  it('PRV-047, CSET-050: a refusal is returned as such, and recorded as failed', async () => {
    const harness = await space.calls();
    harness.mock.script('narrator', answer('I cannot write that.', { finishReason: 'refusal' }));
    const { streamOptions } = options(harness);
    const result = await harness.streamText(streamOptions);
    expect(result.ok && result.value.finishReason).toBe('refusal');
    expect(harness.records()[0]?.outcome).toBe('failed');
  });

  it('PRV-001: npc-voice uses the narrator profile while its own role is unassigned', async () => {
    const harness = await space.calls();
    harness.mock.script('npc-voice', answer('"Ask me tomorrow," he mutters.'));
    const { streamOptions } = options(harness, { role: 'npc-voice' });
    const result = await harness.streamText(streamOptions);
    expect(result.ok).toBe(true);
    expect(harness.records()[0]).toMatchObject({ role: 'npc-voice', profileId: 'test-model' });
  });
});
