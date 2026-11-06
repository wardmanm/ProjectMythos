// Helpers for the settings probe's tests: a probe with a real job queue whose campaigns
// and event bus only remember being used, the mock adapter behind the profile's provider,
// fake time, and answers to script it with. Not exported from index.ts.
import {
  err,
  MachineConfigSchema,
  type ModelProfileSchema,
  ok,
  type ProbeResult,
} from '@mythos/contracts';
import type { z } from 'zod';
import { createEventBus } from '../events';
import { createMockAdapter, type MockAdapter } from './mock-adapter';
import { type MockOutcome, mockProviderError, mockResponse } from './mock-outputs';
import { createProbe } from './probe';
import { createJobQueue, type InteractiveOptions, type JobQueue } from './queue';
import { createFakeTimer, recordingLogger } from './queue-testing';
import type { ProviderAdapter, TextResponse } from './types';

export type ProviderInput = z.input<typeof MachineConfigSchema>['providers'][number];

export type Setup = {
  /** Changes to the one profile, `test-model`, on model `mock` with method `json-schema`. */
  profile?: Partial<z.input<typeof ModelProfileSchema>>;
  /** The profile's provider; the mock adapter answers for it whatever its type. */
  provider?: ProviderInput;
};

/**
 * A probe with a real queue on device `gpu`, whose campaigns and event bus only remember
 * being used, and the mock adapter behind the provider. `where` lists every
 * `runInteractive` call's options, in order.
 */
export function probeHarness(setup: Setup = {}) {
  const provider = setup.provider ?? { id: 'mock', type: 'mock', deviceId: 'gpu' };
  const config = MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers: [provider],
    modelProfiles: [
      {
        id: 'test-model',
        providerId: provider.id,
        model: 'mock',
        kind: 'text',
        contextWindow: 8192,
        maxOutputTokens: 512,
        structuredOutput: 'json-schema',
        sampling: { temperature: 0.7 },
        ...setup.profile,
      },
    ],
  });
  const configStore = { current: () => ok(config) };
  const timer = createFakeTimer();
  const opened: string[] = [];
  const published: string[] = [];
  const bus = createEventBus({ firstId: 1 });
  const queue = createJobQueue({
    config: configStore,
    campaigns: {
      openCampaign: (campaignId) => {
        opened.push(campaignId);
        return err({ code: 'not_found', message: 'The probe opens no campaign.' });
      },
      listCampaigns: () => Promise.resolve([]),
    },
    publish: (campaignId, payload) => {
      published.push(campaignId);
      return bus.publish(campaignId, payload);
    },
    timeSource: timer.timeSource,
    setTimer: timer.setTimer,
    logger: recordingLogger().logger,
  });
  const where: InteractiveOptions[] = [];
  const spied: Pick<JobQueue, 'runInteractive' | 'cancel'> = {
    runInteractive(options, work) {
      where.push(options);
      return queue.runInteractive(options, work);
    },
    cancel(jobId) {
      queue.cancel(jobId);
    },
  };
  const mock = createMockAdapter({ id: 'mock', type: 'mock', deviceId: 'gpu', delayMs: 0 });
  let adapter: ProviderAdapter = mock;
  const { probe } = createProbe({
    config: configStore,
    queue: spied,
    adapterFor: () => adapter,
    timeSource: timer.timeSource,
  });
  return {
    probe: (signal = new AbortController().signal, profileId = 'test-model') =>
      probe(profileId, signal),
    mock,
    timer,
    config,
    where,
    opened,
    published,
    /** Puts another adapter behind the provider, usually the mock with a member replaced. */
    use(next: ProviderAdapter): void {
      adapter = next;
    },
  };
}

export type Harness = ReturnType<typeof probeHarness>;

export const valid = '{"inn": "The Tarred Gull", "rooms": 6}';
/** Text `jsonrepair` refuses, so it stays a parse error (05-providers Traps). */
export const unparseable = '{"a": "x" : "y"}';
export const wrongShape = '{"inn": "", "rooms": 0}';

export function answer(
  text: string,
  overrides: Partial<Omit<TextResponse, 'text'>> = {},
): MockOutcome {
  return { type: 'response', response: mockResponse(text, overrides) };
}

export function failure(
  code: Parameters<typeof mockProviderError>[0],
  message?: string,
): MockOutcome {
  return { type: 'error', error: mockProviderError(code, message) };
}

export const narration = answer('The ferry bumps against the quay, and the gulls lift as one.');

export function valueOf(result: Awaited<ReturnType<Harness['probe']>>): ProbeResult {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** What each request asked for: its structured-output method, or `text`. */
export function sentKinds(mock: MockAdapter): string[] {
  return mock.requests.map((req) =>
    req.format.type === 'json' ? req.profile.structuredOutput : 'text',
  );
}

/**
 * The mock with a text request that takes `promptMs` of fake time to its first delta and
 * `generationMs` more to finish, answering `response`. Structured requests go to the mock.
 */
export function timedText(
  harness: Harness,
  timing: { promptMs: number; generationMs: number; response: TextResponse },
): ProviderAdapter {
  const { mock, timer } = harness;
  return {
    ...mock,
    text: {
      generate: (req) => {
        if (req.format.type === 'json') return mock.text.generate(req);
        timer.advance(timing.promptMs);
        req.onDelta?.('The ');
        timer.advance(timing.generationMs);
        return Promise.resolve(ok(timing.response));
      },
    },
  };
}

export function usage(
  inputTokens: number,
  outputTokens: number,
  cachedInputTokens: number | null = null,
) {
  return { inputTokens, outputTokens, cachedInputTokens };
}
