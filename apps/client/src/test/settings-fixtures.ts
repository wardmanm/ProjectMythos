// Valid machine config for tests, parsed with the contract schema so it cannot drift from it.
import { MachineConfigSchema, type MachineConfig } from '@mythos/contracts';
import type { z } from 'zod';

type MachineConfigInput = z.input<typeof MachineConfigSchema>;

/**
 * The machine config `GET /settings` answers with: one device, one Ollama provider, and
 * one text profile assigned to the narrator. `changes` replaces whole top-level sections,
 * e.g. `machineConfig({ modelProfiles: [], roles: {} })` for a first start.
 */
export function machineConfig(changes: Partial<MachineConfigInput> = {}): MachineConfig {
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'macbook-gpu', name: 'MacBook Pro GPU' }],
    providers: [
      {
        id: 'ollama-local',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        deviceId: 'macbook-gpu',
      },
    ],
    modelProfiles: [
      {
        id: 'qwen-local',
        providerId: 'ollama-local',
        model: 'qwen3.6:35b-a3b',
        kind: 'text',
        contextWindow: 32768,
        maxOutputTokens: 2048,
        structuredOutput: 'json-schema',
      },
    ],
    roles: { narrator: { profileId: 'qwen-local' } },
    ...changes,
  });
}
