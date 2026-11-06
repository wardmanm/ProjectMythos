import { type MachineConfig, MachineConfigSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { routeRole } from './role-routing';

function configWith(roles: Record<string, unknown>): MachineConfig {
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers: [{ id: 'mock', type: 'mock', deviceId: 'gpu' }],
    modelProfiles: [
      {
        id: 'small',
        providerId: 'mock',
        model: 'mock-small',
        kind: 'text',
        contextWindow: 8192,
        maxOutputTokens: 512,
        structuredOutput: 'json-schema',
        sampling: { temperature: 0.7, presencePenalty: 1.5 },
      },
    ],
    roles,
  });
}

describe('routeRole', () => {
  it('PRV-001: a call for an unassigned role fails with not_configured naming the role', () => {
    const routed = routeRole(configWith({}), 'adjudicator');
    expect(routed).toEqual({
      ok: false,
      error: {
        code: 'not_configured',
        message: 'No model is assigned to the adjudicator role. Choose one in Settings.',
      },
    });
  });

  it('PRV-001: an assigned role gets its profile and provider', () => {
    const routed = routeRole(configWith({ narrator: { profileId: 'small' } }), 'narrator');
    expect(routed.ok).toBe(true);
    if (!routed.ok) return;
    expect(routed.value.profile.id).toBe('small');
    expect(routed.value.provider.id).toBe('mock');
    expect(routed.value.sampling).toEqual({ temperature: 0.7, presencePenalty: 1.5 });
  });

  it("PRV-001: the role's sampling overrides the profile's key by key", () => {
    const config = configWith({
      adjudicator: { profileId: 'small', sampling: { temperature: 0.3 } },
    });
    const routed = routeRole(config, 'adjudicator');
    expect(routed.ok && routed.value.sampling).toEqual({ temperature: 0.3, presencePenalty: 1.5 });
  });

  it("PRV-001: npc-voice falls back to the narrator's assignment, and the segmenter to the extractor's", () => {
    const config = configWith({
      narrator: { profileId: 'small', sampling: { temperature: 0.9 } },
      extractor: { profileId: 'small', sampling: { temperature: 0.1 } },
    });
    const voice = routeRole(config, 'npc-voice');
    expect(voice.ok && voice.value.sampling.temperature).toBe(0.9);
    const segmenter = routeRole(config, 'speech-segmenter');
    expect(segmenter.ok && segmenter.value.sampling.temperature).toBe(0.1);
  });

  it('PRV-001: a fallback that is unassigned too names both roles', () => {
    const routed = routeRole(configWith({}), 'npc-voice');
    expect(!routed.ok && routed.error.message).toBe(
      'No model is assigned to the npc-voice role or to the narrator role it falls back to. ' +
        'Choose one in Settings.',
    );
  });

  it('PRV-001: an unassigned illustrator is not_configured, since its fallback is templates', () => {
    const routed = routeRole(configWith({ narrator: { profileId: 'small' } }), 'illustrator');
    expect(!routed.ok && routed.error.code).toBe('not_configured');
  });
});
