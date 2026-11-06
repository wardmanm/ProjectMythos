// Each provider's status, for the settings screen's indicator per provider (PRV-091).
// Every provider in machine config is checked at once, and each check gets at most five
// seconds, so one hung server can neither hold up the others nor the screen.
import {
  type AppError,
  err,
  ok,
  type ProviderConfig,
  type ProviderHealth,
  type ProviderStatusSchema,
  type Result,
} from '@mythos/contracts';
import type { z } from 'zod';
import type { ConfigStore } from '../config';
import type { QueueLogger, SetTimer } from './queue';
import type { ProviderAdapter } from './types';

/** One provider's health, as `GET /settings/providers` lists it (03-contracts §14.1). */
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;

/**
 * How long a status waits for a provider's `health`. It bounds the whole check, on top
 * of the adapters' own 10-second idle timeout (05-providers Decisions).
 */
export const HEALTH_TIMEOUT_MS = 5_000;

/** What the health check needs from the composition root (ARCH-022). */
export type HealthCheckOptions = {
  /** Read once per call, so a provider added in Settings is checked next time (PRV-004). */
  config: Pick<ConfigStore, 'current'>;
  /** The adapter for a provider in machine config: `createAdapter(provider, deps)`. */
  adapterFor: (provider: ProviderConfig) => ProviderAdapter;
  /** Starts the timeout; the queue's `SetTimer`, so tests control it. */
  setTimer: SetTimer;
  logger: QueueLogger;
};

export type HealthCheck = {
  /** Every provider's status, in config order, or the error if the config fails to load. */
  statuses(): Promise<Result<ProviderStatus[], AppError>>;
};

/** Builds the health check. Called once, by the composition root (ARCH-022). */
export function createHealthCheck(options: HealthCheckOptions): HealthCheck {
  return {
    async statuses() {
      const state = options.config.current();
      if (!state.ok) return err(state.error);
      const { providers } = state.value;
      return ok(await Promise.all(providers.map((provider) => statusOf(options, provider))));
    },
  };
}

/**
 * One provider's status: its adapter's `health`, or unreachable once five seconds pass,
 * which also aborts the check. Implements PRV-091.
 */
async function statusOf(
  deps: HealthCheckOptions,
  provider: ProviderConfig,
): Promise<ProviderStatus> {
  const controller = new AbortController();
  let stopTimer: () => void = () => undefined;
  const timedOut = new Promise<ProviderHealth>((resolve) => {
    stopTimer = deps.setTimer(HEALTH_TIMEOUT_MS, () => {
      controller.abort();
      resolve(unreachable(`${describe(provider)} did not answer within 5 seconds.`));
    });
  });
  try {
    const health = await Promise.race([checked(deps, provider, controller.signal), timedOut]);
    return { providerId: provider.id, health };
  } finally {
    stopTimer();
  }
}

/**
 * The adapter's own answer. A check that throws, as building a comfyui adapter does until
 * phase 9, is logged and reported as unreachable, so the other providers still report.
 */
async function checked(
  deps: HealthCheckOptions,
  provider: ProviderConfig,
  signal: AbortSignal,
): Promise<ProviderHealth> {
  try {
    return await deps.adapterFor(provider).health(signal);
  } catch (error: unknown) {
    deps.logger.warn({ providerId: provider.id, err: error }, 'provider health check threw');
    return unreachable(`${describe(provider)} could not be checked.`);
  }
}

function unreachable(detail: string): ProviderHealth {
  return { reachable: false, latencyMs: null, detail };
}

/** A provider in plain words, as the adapters name it in their messages. */
function describe(provider: ProviderConfig): string {
  switch (provider.type) {
    case 'ollama':
      return `Ollama at ${originOf(provider.baseUrl)}`;
    case 'openai-compatible':
      return `${provider.id} (OpenAI-compatible) at ${originOf(provider.baseUrl)}`;
    case 'anthropic':
      return `Anthropic at ${originOf(provider.baseUrl ?? 'https://api.anthropic.com')}`;
    case 'comfyui':
      return `ComfyUI at ${originOf(provider.baseUrl)}`;
    case 'mock':
      return `The mock provider "${provider.id}"`;
  }
}

/** The address without its path, so no path or query reaches the screen. */
function originOf(url: string): string {
  return URL.canParse(url) ? new URL(url).origin : 'its configured address';
}
