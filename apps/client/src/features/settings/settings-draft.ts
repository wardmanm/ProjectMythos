// The settings form's draft of machine config: one draft, saved whole with PUT /settings
// (PRV-003). List items carry a client key, so a row stays the same row while its id is
// edited, and a save's issues follow their item (CON-091). Pure functions only.
import {
  DeviceSchema,
  ModelProfileSchema,
  ProviderConfigSchema,
  type MachineConfig,
  type ModelProfile,
  type ProviderConfig,
} from '@mythos/contracts';
import type { z } from 'zod';

export type Device = z.infer<typeof DeviceSchema>;
export type Keyed<T> = { key: string; value: T };

/** Machine config with its three id-keyed lists keyed for the form. */
export type SettingsDraft = Omit<MachineConfig, 'devices' | 'providers' | 'modelProfiles'> & {
  devices: Keyed<Device>[];
  providers: Keyed<ProviderConfig>[];
  modelProfiles: Keyed<ModelProfile>[];
};

export const LIST_NAMES = ['devices', 'providers', 'modelProfiles'] as const;
export type ListName = (typeof LIST_NAMES)[number];

/** A saved item's key is its saved id, which never changes (14-ui Decisions). */
function savedKey(id: string): string {
  return `saved:${id}`;
}

let newItemCount = 0;

/** A key no saved item can have. */
export function newItemKey(): string {
  newItemCount += 1;
  return `new:${String(newItemCount)}`;
}

function keyed<T extends { id: string }>(items: T[]): Keyed<T>[] {
  return items.map((value) => ({ key: savedKey(value.id), value }));
}

/** The draft of a config as `GET /settings` or a save answered it. */
export function draftFrom(config: MachineConfig): SettingsDraft {
  return {
    ...config,
    devices: keyed(config.devices),
    providers: keyed(config.providers),
    modelProfiles: keyed(config.modelProfiles),
  };
}

/**
 * The config a save sends. `server.pin` always comes from the latest `GET /settings`,
 * never from the draft: the PIN changes only through `PUT /settings/pin`, which ends
 * every session (01-architecture Decisions). Implements CON-111 with the placeholders the
 * draft keeps as they came.
 */
export function configFrom(
  draft: SettingsDraft,
  pin: MachineConfig['server']['pin'],
): MachineConfig {
  return {
    ...draft,
    server: { ...draft.server, pin },
    devices: draft.devices.map((item) => item.value),
    providers: draft.providers.map((item) => item.value),
    modelProfiles: draft.modelProfiles.map((item) => item.value),
  };
}

/** Whether the draft differs from the saved config, leaving out the PIN. */
export function isDirty(draft: SettingsDraft, base: SettingsDraft): boolean {
  return !sameValue(configFrom(draft, null), configFrom(base, null));
}

export type ItemState = 'new' | 'changed' | 'saved';

/** Whether a list item is new, saved with changes, or as saved. */
export function itemState<T>(item: Keyed<T>, baseList: Keyed<T>[]): ItemState {
  const saved = baseList.find((candidate) => candidate.key === item.key);
  if (saved === undefined) return 'new';
  return sameValue(saved.value, item.value) ? 'saved' : 'changed';
}

/** The provider a profile names, if the draft has one with that id. */
export function providerOf(
  draft: SettingsDraft,
  providerId: string,
): Keyed<ProviderConfig> | undefined {
  return draft.providers.find((item) => item.value.id === providerId);
}

/** `<stem>-<n>`, the first that no item in `taken` uses as its id. */
export function uniqueConfigId(stem: string, taken: readonly { value: { id: string } }[]): string {
  const ids = new Set(taken.map((item) => item.value.id));
  for (let n = 1; ; n += 1) {
    const id = n === 1 ? stem : `${stem}-${String(n)}`;
    if (!ids.has(id)) return id;
  }
}

/** A new device, with the schema's defaults. */
export function newDevice(draft: SettingsDraft): Keyed<Device> {
  const id = uniqueConfigId('device', draft.devices);
  return { key: newItemKey(), value: DeviceSchema.parse({ id, name: 'New device' }) };
}

export type EditableProviderType = 'ollama' | 'openai-compatible' | 'anthropic' | 'mock';

/** What a provider of each type starts with; the schema adds its defaults. */
const providerStarts = {
  ollama: { type: 'ollama', baseUrl: 'http://localhost:11434' },
  'openai-compatible': { type: 'openai-compatible', baseUrl: 'http://localhost:1234/v1' },
  anthropic: { type: 'anthropic', apiKey: { env: 'ANTHROPIC_API_KEY' } },
  mock: { type: 'mock' },
} as const satisfies Record<EditableProviderType, Record<string, unknown>>;

/** A provider of `type` with the given id and device, and the schema's defaults. */
export function providerOfType(
  type: EditableProviderType,
  id: string,
  deviceId: string,
): ProviderConfig {
  // Parsed with placeholder ids, which are always valid, so an id still being typed
  // cannot make the parse throw.
  const parsed = ProviderConfigSchema.parse({ ...providerStarts[type], id: 'x', deviceId: 'x' });
  return { ...parsed, id, deviceId };
}

/** A new Ollama provider on the first device. */
export function newProvider(draft: SettingsDraft): Keyed<ProviderConfig> {
  const id = uniqueConfigId('provider', draft.providers);
  const deviceId = draft.devices[0]?.value.id ?? '';
  return { key: newItemKey(), value: providerOfType('ollama', id, deviceId) };
}

/** A new text profile on the first provider, with no model chosen yet. */
export function newProfile(draft: SettingsDraft): Keyed<ModelProfile> {
  const id = uniqueConfigId('profile', draft.modelProfiles);
  const parsed = ModelProfileSchema.parse({
    id: 'x',
    providerId: 'x',
    model: 'x',
    kind: 'text',
    contextWindow: 32_768,
    maxOutputTokens: 2_048,
    structuredOutput: 'json-schema',
  });
  const providerId = draft.providers[0]?.value.id ?? '';
  return { key: newItemKey(), value: { ...parsed, id, providerId, model: '' } };
}

/** Replaces the item with `key` in one of the draft's lists. */
export function replaceItem<T>(list: Keyed<T>[], key: string, value: T): Keyed<T>[] {
  return list.map((item) => (item.key === key ? { key, value } : item));
}

/** Removes the item with `key` from one of the draft's lists. */
export function removeItem<T>(list: Keyed<T>[], key: string): Keyed<T>[] {
  return list.filter((item) => item.key !== key);
}

/**
 * A copy of `value` with an optional field set, or left out when `field` is undefined:
 * with `exactOptionalPropertyTypes` an optional field is omitted, never set to undefined.
 */
export function withOptional<T extends object, K extends keyof T>(
  value: T,
  key: K,
  field: T[K] | undefined,
): T {
  const copy = { ...value };
  // Reflect, since lint forbids `delete` with a computed key; `key` is a typed field name.
  if (field === undefined) Reflect.deleteProperty(copy, key);
  else copy[key] = field;
  return copy;
}

/** Deep equality for JSON-like data, ignoring key order. NaN equals NaN. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  const otherKeys = Object.keys(b).filter((key) => b[key] !== undefined);
  if (keys.length !== otherKeys.length) return false;
  return keys.every((key) => sameValue(a[key], b[key]));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
