import { type ProviderConfig, ProviderConfigSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { createAdapter } from './registry';

describe('createAdapter', () => {
  it('ARCH-133: builds the mock as a ProviderAdapter with text and embedding members', async () => {
    const config = ProviderConfigSchema.parse({ id: 'mock', type: 'mock', deviceId: 'cpu' });
    const adapter = createAdapter(config);
    const signal = new AbortController().signal;

    expect(adapter.config).toBe(config);
    expect(typeof adapter.text?.generate).toBe('function');
    expect(typeof adapter.embedding?.embed).toBe('function');
    expect(await adapter.health(signal)).toMatchObject({ reachable: true, latencyMs: 0 });
    expect(await adapter.listModels(signal)).toEqual({ ok: true, value: ['mock'] });
  });

  it.each([
    [
      { id: 'ollama', type: 'ollama', baseUrl: 'http://localhost:11434', deviceId: 'gpu' },
      'P1-T11',
    ],
    [
      {
        id: 'lm-studio',
        type: 'openai-compatible',
        baseUrl: 'http://localhost:1234/v1',
        deviceId: 'gpu',
      },
      'P1-T11',
    ],
    [{ id: 'claude', type: 'anthropic', deviceId: 'cloud', apiKey: { env: 'KEY' } }, 'P1-T12'],
    [
      { id: 'comfy', type: 'comfyui', baseUrl: 'http://localhost:8188', deviceId: 'gpu' },
      'phase 9',
    ],
  ])('ARCH-133: an adapter still to come throws, naming when it arrives', (input, arrives) => {
    const config: ProviderConfig = ProviderConfigSchema.parse(input);
    expect(() => createAdapter(config)).toThrow(arrives);
  });
});
