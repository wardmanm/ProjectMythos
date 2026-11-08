import { MachineConfigSchema, type MachineConfig } from '@mythos/contracts';

/**
 * The default machine config, which "Start from default settings" saves over a broken
 * file: one device, one Ollama provider on localhost, no model profiles, and every role
 * unassigned. It matches `defaultMachineConfigFile()` in the server's config module,
 * which the client cannot import (ARCH-010). Parsed, so the schema adds its defaults.
 * Implements PRV-001.
 */
export function defaultMachineConfig(): MachineConfig {
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'this-computer', name: 'This computer' }],
    providers: [
      {
        id: 'ollama-local',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        deviceId: 'this-computer',
      },
    ],
    modelProfiles: [],
    roles: {
      adjudicator: null,
      narrator: null,
      'npc-voice': null,
      extractor: null,
      consolidator: null,
      'world-ticker': null,
      embedder: null,
      illustrator: null,
      'speech-segmenter': null,
    },
  });
}
