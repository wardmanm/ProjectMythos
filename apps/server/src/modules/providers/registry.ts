// Builds the adapter for a configured provider. Every adapter has the one shape in
// types.ts, whose optional members are the kinds it serves (ARCH-133).
import type { ProviderConfig } from '@mythos/contracts';
import { createMockAdapter } from './mock-adapter';
import type { ProviderAdapter } from './types';

/**
 * The adapter for one provider in machine config, chosen by its `type`. Adapters that
 * have not arrived yet throw, naming the task that brings them. Implements ARCH-133.
 */
export function createAdapter(config: ProviderConfig): ProviderAdapter {
  switch (config.type) {
    case 'mock':
      return createMockAdapter(config);
    case 'ollama':
    case 'openai-compatible':
      throw new Error(`The ${config.type} adapter arrives in P1-T11.`);
    case 'anthropic':
      throw new Error('The anthropic adapter arrives in P1-T12.');
    case 'comfyui':
      throw new Error('The comfyui adapter arrives in phase 9 (15-media.md §4).');
    default: {
      const unknown: never = config;
      throw new Error(`Unknown provider type in ${JSON.stringify(unknown)}`);
    }
  }
}
