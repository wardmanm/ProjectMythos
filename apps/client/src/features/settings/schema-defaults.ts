// The defaults the settings screen shows ("Default: …", UI-088), read from the contract
// schemas by parsing the least each one accepts, so no default is copied into the client.
import {
  DeviceSchema,
  MachineConfigSchema,
  ModelProfileSchema,
  ProviderConfigSchema,
} from '@mythos/contracts';

const config = MachineConfigSchema.parse({
  schemaVersion: 1,
  devices: [{ id: 'x', name: 'x' }],
  providers: [{ id: 'x', type: 'mock', deviceId: 'x' }],
});

const profile = ModelProfileSchema.parse({
  id: 'x',
  providerId: 'x',
  model: 'x',
  kind: 'text',
  contextWindow: 1,
  maxOutputTokens: 1,
  structuredOutput: 'prompt-only',
});

const device = DeviceSchema.parse({ id: 'x', name: 'x' });

function ollamaKeepAlive(): string {
  const parsed = ProviderConfigSchema.parse({
    id: 'x',
    type: 'ollama',
    baseUrl: 'http://localhost',
    deviceId: 'x',
  });
  return parsed.type === 'ollama' ? parsed.keepAlive : '';
}

function mockDelayMs(): number {
  const parsed = ProviderConfigSchema.parse({ id: 'x', type: 'mock', deviceId: 'x' });
  return parsed.type === 'mock' ? parsed.delayMs : 0;
}

export const schemaDefaults = {
  config,
  profile,
  device,
  ollamaKeepAlive: ollamaKeepAlive(),
  mockDelayMs: mockDelayMs(),
};
