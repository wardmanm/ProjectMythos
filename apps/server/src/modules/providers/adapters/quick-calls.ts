// The short calls behind an adapter's `health` and `listModels` (PRV-091): one GET, read
// as JSON, under a fixed timeout, since no model profile is involved to give one.
import type { ProviderHealth, Result, TimeSource } from '@mythos/contracts';
import type { z } from 'zod';
import type { ProviderError } from '../types';
import { sendRequest } from './http';

/** The idle timeout for `health` and `listModels`. */
export const QUICK_CALL_TIMEOUT_MS = 10_000;

/** A GET to a provider, with its body parsed as JSON and then with `schema`. */
export async function getJson<T>(
  request: {
    provider: string;
    url: string;
    headers?: Readonly<Record<string, string>>;
    signal: AbortSignal;
    secrets?: readonly string[];
  },
  schema: z.ZodType<T>,
  timeSource: TimeSource,
): Promise<Result<T, ProviderError>> {
  const sent = await sendRequest(
    { ...request, method: 'GET', timeoutMs: QUICK_CALL_TIMEOUT_MS },
    timeSource,
  );
  return sent.ok ? sent.value.json(schema) : sent;
}

/**
 * A provider's health from one short call: reachable, with the round trip's latency and
 * `probe`'s detail, or unreachable with the error's message in plain words. Any error,
 * a rejected key included, counts as unreachable, since no model call would get through.
 */
export async function measureHealth(
  timeSource: TimeSource,
  probe: () => Promise<Result<string, ProviderError>>,
): Promise<ProviderHealth> {
  const started = timeSource.now();
  const result = await probe();
  if (!result.ok) return { reachable: false, latencyMs: null, detail: result.error.message };
  return {
    reachable: true,
    latencyMs: Math.max(0, timeSource.now() - started),
    detail: result.value,
  };
}
