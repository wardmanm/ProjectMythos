import { type ProviderConfig, ProviderConfigSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { type AdapterDependencies, createAdapter } from './registry';

const deps: AdapterDependencies = { env: {}, timeSource: { now: () => 0 } };

describe('createAdapter', () => {
  it('ARCH-133: builds the mock as a ProviderAdapter with text and embedding members', async () => {
    const config = ProviderConfigSchema.parse({ id: 'mock', type: 'mock', deviceId: 'cpu' });
    const adapter = createAdapter(config, deps);
    const signal = new AbortController().signal;

    expect(adapter.config).toBe(config);
    expect(typeof adapter.text?.generate).toBe('function');
    expect(typeof adapter.embedding?.embed).toBe('function');
    expect(await adapter.health(signal)).toMatchObject({ reachable: true, latencyMs: 0 });
    expect(await adapter.listModels(signal)).toEqual({ ok: true, value: ['mock'] });
  });

  it.each([
    ['ollama', { baseUrl: 'http://127.0.0.1:11434' }],
    ['openai-compatible', { baseUrl: 'http://127.0.0.1:1234/v1' }],
  ])('ARCH-133, PRV-010: builds the %s adapter with a text member', (type, rest) => {
    const config = ProviderConfigSchema.parse({ id: 'local', type, deviceId: 'gpu', ...rest });
    const adapter = createAdapter(config, deps);

    expect(adapter.config).toBe(config);
    expect(typeof adapter.text?.generate).toBe('function');
    expect(adapter.embedding).toBeUndefined();
  });

  const toCome: [type: string, rest: Record<string, unknown>, arrives: string][] = [
    ['anthropic', { apiKey: { env: 'ANTHROPIC_API_KEY' } }, 'P1-T12'],
    ['comfyui', { baseUrl: 'http://localhost:8188' }, 'phase 9'],
  ];

  it.each(toCome)('ARCH-133: the %s adapter throws until it arrives', (type, rest, arrives) => {
    const config: ProviderConfig = ProviderConfigSchema.parse({
      id: 'later',
      type,
      deviceId: 'gpu',
      ...rest,
    });
    expect(() => createAdapter(config, deps)).toThrow(arrives);
  });
});
