// Builds the adapter for a configured provider. Every adapter has the one shape in
// types.ts, whose optional members are the kinds it serves (ARCH-133).
import type { ProviderConfig, TimeSource } from '@mythos/contracts';
import type { DataDirEnv } from '../config';
import { createAnthropicAdapter } from './adapters/anthropic';
import { createOllamaAdapter } from './adapters/ollama';
import { createOpenAiCompatibleAdapter } from './adapters/openai-compatible';
import { createMockAdapter } from './mock-adapter';
import type { ProviderAdapter } from './types';

/**
 * What every adapter gets from the composition root (ARCH-022): the environment that
 * `{ env }` API keys are read from (PRV-005), and the wall-time source, which turns an
 * HTTP-date `retry-after` into seconds (PRV-013, CONV-061).
 */
export type AdapterDependencies = {
  env: DataDirEnv;
  timeSource: TimeSource;
};

/**
 * The adapter for one provider in machine config, chosen by its `type`. Adapters that
 * have not arrived yet throw, naming the task that brings them. The mock needs none of
 * `deps`. Implements ARCH-133.
 */
export function createAdapter(config: ProviderConfig, deps: AdapterDependencies): ProviderAdapter {
  switch (config.type) {
    case 'mock':
      return createMockAdapter(config);
    case 'ollama':
      return createOllamaAdapter(config, deps);
    case 'openai-compatible':
      return createOpenAiCompatibleAdapter(config, deps);
    case 'anthropic':
      return createAnthropicAdapter(config, deps);
    case 'comfyui':
      throw new Error('The comfyui adapter arrives in phase 9 (15-media.md §4).');
    default: {
      const unknown: never = config;
      throw new Error(`Unknown provider type in ${JSON.stringify(unknown)}`);
    }
  }
}
