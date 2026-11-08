// Valid settings data for tests, parsed with the contract schemas so it cannot drift from them.
import {
  MachineConfigSchema,
  ProbeResultSchema,
  ProviderStatusSchema,
  SessionStateSchema,
  type MachineConfig,
  type ProbeResult,
} from '@mythos/contracts';
import { z } from 'zod';

type MachineConfigInput = z.input<typeof MachineConfigSchema>;
type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
type SessionState = z.infer<typeof SessionStateSchema>;

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

/** What `GET /settings/providers` answers for `machineConfig()`: Ollama is reachable. */
export function providerStatuses(statuses?: ProviderStatus[]): ProviderStatus[] {
  return z.array(ProviderStatusSchema).parse(
    statuses ?? [
      {
        providerId: 'ollama-local',
        health: { reachable: true, latencyMs: 12, detail: 'Ollama 0.40.14 is running' },
      },
    ],
  );
}

/** A probe of `qwen-local` that found the model, with every method giving valid output. */
export function probeResult(changes: Partial<ProbeResult> = {}): ProbeResult {
  return ProbeResultSchema.parse({
    profileId: 'qwen-local',
    reachable: true,
    modelPresent: true,
    structuredMethods: { 'json-schema': true, 'tool-call': true, 'prompt-only': true },
    promptTokensPerSecond: 812.4,
    generationTokensPerSecond: 44.6,
    emittedThinking: false,
    suggestions: ['Keep json-schema: it gave valid output.'],
    ...changes,
  });
}

/** What `GET /session` answers: by default, a device that must log in and has not. */
export function sessionState(changes: Partial<SessionState> = {}): SessionState {
  return SessionStateSchema.parse({ pinRequired: true, authenticated: false, ...changes });
}
