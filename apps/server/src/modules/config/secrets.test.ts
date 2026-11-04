import { type MachineConfig, MachineConfigSchema, SECRET_PLACEHOLDER } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { mergeSecrets, redact, resolveSecret } from './secrets';

/** A small seeded generator (mulberry32), so a failing case can be replayed by its seed. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** A config with random providers and random inline secrets, and the secrets it holds. */
function randomConfig(seed: number): { config: MachineConfig; secrets: string[] } {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const secrets: string[] = [];
  const newSecret = (): string => {
    let secret = 'sk-';
    for (let i = 0; i < 24; i++) secret += alphabet.charAt(Math.floor(random() * alphabet.length));
    secrets.push(secret);
    return secret;
  };
  const someKey = () => (random() < 0.7 ? { value: newSecret() } : { env: 'SOME_API_KEY' });

  const providers = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, index) => {
    const id = `provider-${String(index)}`;
    const type = pick(['ollama', 'openai-compatible', 'anthropic', 'mock'] as const);
    if (type === 'anthropic') return { id, type, deviceId: 'gpu', apiKey: someKey() };
    if (type === 'openai-compatible') {
      const apiKey = random() < 0.8 ? { apiKey: someKey() } : {};
      return { id, type, baseUrl: 'http://localhost:1234/v1', deviceId: 'gpu', ...apiKey };
    }
    if (type === 'mock') return { id, type, deviceId: 'gpu' };
    return { id, type, baseUrl: 'http://localhost:11434', deviceId: 'gpu' };
  });
  const pin = random() < 0.5 ? { hash: newSecret() } : null;
  const config = MachineConfigSchema.parse({
    schemaVersion: 1,
    server: { pin },
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers,
  });
  return { config, secrets };
}

function configWithKeys(): MachineConfig {
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'cloud', name: 'Cloud' }],
    providers: [
      { id: 'anthropic', type: 'anthropic', deviceId: 'cloud', apiKey: { value: 'sk-ant-A' } },
      {
        id: 'router',
        type: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        deviceId: 'cloud',
        apiKey: { value: 'sk-or-B' },
      },
      {
        id: 'env-only',
        type: 'anthropic',
        deviceId: 'cloud',
        apiKey: { env: 'ANTHROPIC_API_KEY' },
      },
    ],
  });
}

describe('redact and mergeSecrets', () => {
  it('CON-111: over random configs, no secret survives redact, and merging it back restores the config', () => {
    let secretsChecked = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { config, secrets } = randomConfig(seed);
      secretsChecked += secrets.length;
      const sent = redact(config);
      const text = JSON.stringify(sent);
      for (const secret of secrets) expect(text, `seed ${String(seed)}`).not.toContain(secret);
      expect(mergeSecrets(sent, config), `seed ${String(seed)}`).toEqual({ config, issues: [] });
    }
    // Guards against a generator that stops producing secrets and passes vacuously.
    expect(secretsChecked).toBeGreaterThan(100);
  });

  it('CON-111: a key follows its provider id when providers are reordered or deleted', () => {
    const stored = configWithKeys();
    const sent = redact(stored);
    // The settings screen deleted "anthropic" and moved "router" to the end.
    const edited = { ...sent, providers: [sent.providers[2], sent.providers[1]] };
    const { config, issues } = mergeSecrets(edited, stored);
    expect(issues).toEqual([]);
    expect(config).toMatchObject({
      providers: [
        { id: 'env-only', apiKey: { env: 'ANTHROPIC_API_KEY' } },
        { id: 'router', apiKey: { value: 'sk-or-B' } },
      ],
    });
  });

  it('CON-111: a placeholder with nothing stored is an issue at its path', () => {
    const stored = configWithKeys();
    const edited = {
      ...redact(stored),
      providers: [
        {
          id: 'new-one',
          type: 'anthropic',
          deviceId: 'cloud',
          apiKey: { value: SECRET_PLACEHOLDER },
        },
      ],
      server: { pin: { hash: SECRET_PLACEHOLDER } },
    };
    expect(mergeSecrets(edited, stored).issues.map((issue) => issue.path)).toEqual([
      'providers.0.apiKey.value',
      'server.pin.hash',
    ]);
    expect(mergeSecrets(redact(stored), null).issues).toHaveLength(2);
  });

  it('CON-111: mergeSecrets never changes what it was given', () => {
    const stored = configWithKeys();
    const sent = redact(stored);
    const before = structuredClone(sent);
    mergeSecrets(sent, stored);
    expect(sent).toEqual(before);
  });

  it('PRV-005: redact keeps env references and replaces the PIN hash', () => {
    const config = MachineConfigSchema.parse({
      ...configWithKeys(),
      server: { pin: { hash: 'scrypt$secret-hash' } },
    });
    const sent = redact(config);
    expect(sent.providers[2]).toMatchObject({ apiKey: { env: 'ANTHROPIC_API_KEY' } });
    expect(sent.server.pin?.hash).toBe(SECRET_PLACEHOLDER);
    expect(config.server.pin?.hash).toBe('scrypt$secret-hash');
  });
});

describe('resolveSecret', () => {
  it('PRV-005: an env secret is read from the environment', () => {
    expect(resolveSecret({ env: 'MY_KEY' }, { MY_KEY: 'sk-env' })).toEqual({
      ok: true,
      value: 'sk-env',
    });
  });

  it('PRV-005: an inline secret is its value', () => {
    expect(resolveSecret({ value: 'sk-inline' }, {})).toEqual({ ok: true, value: 'sk-inline' });
  });

  it('PRV-005: a missing environment variable is not_configured and names the variable', () => {
    const result = resolveSecret({ env: 'MY_KEY' }, { MY_KEY: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_configured');
      expect(result.error.message).toContain('MY_KEY');
    }
  });
});
