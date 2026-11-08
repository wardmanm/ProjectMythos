import { MachineConfigSchema, SECRET_PLACEHOLDER, type ProviderConfig } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { machineConfig } from '@/test/settings-fixtures';
import {
  configFrom,
  draftFrom,
  isDirty,
  itemState,
  newDevice,
  newProfile,
  newProvider,
  providerOfType,
  replaceItem,
  sameValue,
  uniqueConfigId,
  withOptional,
} from './settings-draft';

const pinSet = { hash: SECRET_PLACEHOLDER, localhostExempt: true };

describe('settings draft', () => {
  it('PRV-003: a draft saves as the config it came from, with no client keys', () => {
    const config = machineConfig();
    expect(configFrom(draftFrom(config), config.server.pin)).toEqual(config);
  });

  it("CON-111: a save takes the PIN it is given, never the draft's", () => {
    const draft = draftFrom(machineConfig({ server: { pin: pinSet } }));
    expect(configFrom(draft, null).server.pin).toBeNull();
    expect(
      isDirty(draftFrom(machineConfig({ server: { pin: pinSet } })), draftFrom(machineConfig())),
    ).toBe(false);
  });

  it('PRV-003: an item is new, changed, or as saved', () => {
    const base = draftFrom(machineConfig());
    const [device] = base.devices;
    if (device === undefined) throw new Error('no device');
    expect(itemState(device, base.devices)).toBe('saved');
    const renamed = replaceItem(base.devices, device.key, { ...device.value, name: 'Laptop' });
    expect(itemState(renamed[0] ?? device, base.devices)).toBe('changed');
    expect(itemState(newDevice(base), base.devices)).toBe('new');
  });

  it("PRV-003: new items are valid, with unique ids and the schema's defaults", () => {
    const draft = draftFrom(machineConfig());
    const provider = newProvider(draft).value;
    const profile = newProfile(draft).value;
    const withNew = { ...draft, providers: [...draft.providers, newProvider(draft)] };
    expect(provider).toMatchObject({ id: 'provider', type: 'ollama', keepAlive: '30m' });
    expect(newDevice(draft).value).toEqual({ id: 'device', name: 'New device', concurrency: 1 });
    expect(profile).toMatchObject({ id: 'profile', providerId: 'ollama-local', model: '' });
    expect(uniqueConfigId('provider', withNew.providers)).toBe('provider-2');
    expect(newDevice(draft).key).not.toBe(newDevice(draft).key);
  });

  it("PRV-003: a new provider's type brings that type's fields and keeps its id and device", () => {
    expect(providerOfType('anthropic', 'claude', 'cloud')).toEqual({
      id: 'claude',
      type: 'anthropic',
      deviceId: 'cloud',
      apiKey: { env: 'ANTHROPIC_API_KEY' },
    });
    expect(providerOfType('openai-compatible', 'lm', 'gpu')).toMatchObject({ headers: {} });
    expect(providerOfType('mock', '', '')).toEqual({
      id: '',
      type: 'mock',
      deviceId: '',
      delayMs: 0,
    });
  });

  it('PRV-003: an optional field left blank is left out, never set to undefined', () => {
    const provider: ProviderConfig = {
      id: 'a',
      type: 'anthropic',
      deviceId: 'b',
      apiKey: { env: 'K' },
      baseUrl: 'x',
    };
    expect('baseUrl' in withOptional(provider, 'baseUrl', undefined)).toBe(false);
    expect(withOptional(provider, 'baseUrl', 'y').baseUrl).toBe('y');
  });

  it('PRV-003: values compare deeply, whatever the key order, and NaN equals NaN', () => {
    expect(sameValue({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameValue([1, 2], [1])).toBe(false);
    expect(sameValue(Number.NaN, Number.NaN)).toBe(true);
    expect(sameValue(null, {})).toBe(false);
  });

  it('PRV-003: a config with every list filled round-trips through the schema', () => {
    const config = MachineConfigSchema.parse(machineConfig());
    expect(MachineConfigSchema.parse(configFrom(draftFrom(config), null))).toEqual(config);
  });
});
