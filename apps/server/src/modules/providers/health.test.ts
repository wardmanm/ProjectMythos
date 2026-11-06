import {
  type AppError,
  err,
  type MachineConfig,
  MachineConfigSchema,
  ok,
  type ProviderConfig,
  type ProviderHealth,
  type Result,
} from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHealthCheck, HEALTH_TIMEOUT_MS } from './health';
import { createMockAdapter } from './mock-adapter';
import { createFakeTimer, flush, gate, recordingLogger } from './queue-testing';
import { createAdapter } from './registry';
import type { ProviderAdapter } from './types';

type ProviderInput = z.input<typeof MachineConfigSchema>['providers'][number];

function machineConfig(providers: ProviderInput[]): MachineConfig {
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers,
  });
}

const ollama: ProviderInput = {
  id: 'local',
  type: 'ollama',
  baseUrl: 'http://localhost:11434',
  deviceId: 'gpu',
};
const lmStudio: ProviderInput = {
  id: 'lm-studio',
  type: 'openai-compatible',
  baseUrl: 'http://localhost:1234/v1',
  deviceId: 'gpu',
};
const mock: ProviderInput = { id: 'mock', type: 'mock', deviceId: 'gpu' };

/** The registry builds the mock, and throws for comfyui, which arrives in phase 9. */
const adapterDeps = { env: {}, timeSource: { now: () => 0 } };

/** A mock adapter that answers `health` as the test says, with the signal it was given. */
function adapterWith(
  config: ProviderConfig,
  health: (signal: AbortSignal) => Promise<ProviderHealth>,
): ProviderAdapter {
  const base = createMockAdapter({ id: 'stand-in', type: 'mock', deviceId: 'gpu', delayMs: 0 });
  return { ...base, config, health };
}

/** A health check that never answers, recording the signal it was given. */
function hanging(signals: AbortSignal[]) {
  return (signal: AbortSignal): Promise<ProviderHealth> => {
    signals.push(signal);
    return new Promise<ProviderHealth>(() => undefined);
  };
}

function harness(
  config: Result<MachineConfig, AppError>,
  adapterFor: (provider: ProviderConfig) => ProviderAdapter,
) {
  const timer = createFakeTimer();
  const { logger, entries } = recordingLogger();
  const check = createHealthCheck({
    config: { current: () => config },
    adapterFor,
    setTimer: timer.setTimer,
    logger,
  });
  return { check, timer, logEntries: entries };
}

function valueOf<T>(result: Result<T, AppError>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const reachable = (detail: string): ProviderHealth => ({ reachable: true, latencyMs: 12, detail });

describe('provider health', () => {
  it('PRV-091: statuses come back in config order, whichever answers first', async () => {
    const first = gate<ProviderHealth>();
    const config = machineConfig([ollama, lmStudio, mock]);
    const { check } = harness(ok(config), (provider) => {
      if (provider.id === 'local') return adapterWith(provider, () => first.promise);
      if (provider.id === 'lm-studio') {
        return adapterWith(provider, () => Promise.resolve(reachable('LM Studio is up.')));
      }
      return createAdapter(provider, adapterDeps);
    });
    const pending = check.statuses();
    // The other two have answered before the first does.
    await flush();
    first.open(reachable('Ollama 0.40.14 is running at http://localhost:11434.'));
    expect(valueOf(await pending)).toEqual([
      {
        providerId: 'local',
        health: reachable('Ollama 0.40.14 is running at http://localhost:11434.'),
      },
      { providerId: 'lm-studio', health: reachable('LM Studio is up.') },
      {
        providerId: 'mock',
        health: { reachable: true, latencyMs: 0, detail: 'The mock provider is ready.' },
      },
    ]);
  });

  it('PRV-091: a provider that does not answer within 5 seconds is unreachable, in plain words', async () => {
    const signals: AbortSignal[] = [];
    const { check, timer } = harness(ok(machineConfig([ollama])), (provider) =>
      adapterWith(provider, hanging(signals)),
    );
    const pending = check.statuses();
    timer.advance(HEALTH_TIMEOUT_MS - 1);
    expect(signals.map((signal) => signal.aborted)).toEqual([false]);
    timer.advance(1);
    expect(valueOf(await pending)).toEqual([
      {
        providerId: 'local',
        health: {
          reachable: false,
          latencyMs: null,
          detail: 'Ollama at http://localhost:11434 did not answer within 5 seconds.',
        },
      },
    ]);
    expect(HEALTH_TIMEOUT_MS).toBe(5000);
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  });

  it('PRV-091: two hanging providers both time out after one 5-second wait, so the checks run in parallel', async () => {
    const signals: AbortSignal[] = [];
    const { check, timer } = harness(ok(machineConfig([ollama, lmStudio])), (provider) =>
      adapterWith(provider, hanging(signals)),
    );
    const pending = check.statuses();
    expect(timer.delays).toEqual([5000, 5000]);
    timer.advance(5000);
    const details = valueOf(await pending).map((status) => status.health.detail);
    expect(details).toEqual([
      'Ollama at http://localhost:11434 did not answer within 5 seconds.',
      'lm-studio (OpenAI-compatible) at http://localhost:1234 did not answer within 5 seconds.',
    ]);
  });

  it('PRV-091: a provider whose check throws is unreachable and logged, and the others still report', async () => {
    const comfy: ProviderInput = {
      id: 'images',
      type: 'comfyui',
      baseUrl: 'http://localhost:8188',
      deviceId: 'gpu',
    };
    const { check, logEntries } = harness(ok(machineConfig([comfy, mock])), (provider) =>
      createAdapter(provider, adapterDeps),
    );
    const statuses = valueOf(await check.statuses());
    expect(statuses).toEqual([
      {
        providerId: 'images',
        health: {
          reachable: false,
          latencyMs: null,
          detail: 'ComfyUI at http://localhost:8188 could not be checked.',
        },
      },
      {
        providerId: 'mock',
        health: { reachable: true, latencyMs: 0, detail: 'The mock provider is ready.' },
      },
    ]);
    expect(logEntries).toHaveLength(1);
    expect(logEntries[0]?.fields).toMatchObject({ providerId: 'images' });
  });

  it('PRV-091: a check that answers in time leaves no timer running', async () => {
    const { check, timer } = harness(ok(machineConfig([mock])), (provider) =>
      createAdapter(provider, adapterDeps),
    );
    await check.statuses();
    expect(timer.delays).toEqual([5000]);
    expect(timer.pending()).toBe(0);
  });

  it('PRV-091: a machine config that fails to load returns its error', async () => {
    const broken = err({
      code: 'validation_failed' as const,
      message: 'machine-config.json is broken',
    });
    const { check } = harness(broken, () => {
      throw new Error('No adapter is needed.');
    });
    expect(await check.statuses()).toEqual(broken);
  });
});
