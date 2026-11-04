import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type MachineConfig, MachineConfigSchema } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { checkCrossReferences } from './cross-references';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** The spec's example config (05-providers §2.1), read where it sits in the spec. */
function exampleInput(): Record<string, unknown> {
  const file = path.join(repoRoot, 'spec', 'fixtures', 'test', 'machine-config.json');
  return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
}

/** The example with `change` applied to its raw JSON, then parsed so defaults fill in. */
function configWith(change: (input: Record<string, unknown>) => void): MachineConfig {
  const input = exampleInput();
  change(input);
  return MachineConfigSchema.parse(input);
}

const paths = (config: MachineConfig) => checkCrossReferences(config).map((issue) => issue.path);

describe('checkCrossReferences', () => {
  it('PRV-002: the spec example has no issues', () => {
    expect(checkCrossReferences(configWith(() => undefined))).toEqual([]);
  });

  it('PRV-002: three broken references are all reported, each with its path', () => {
    const config = configWith((input) => {
      input.providers = [
        {
          id: 'ollama-local',
          type: 'ollama',
          baseUrl: 'http://localhost:11434',
          deviceId: 'nowhere',
        },
      ];
      input.modelProfiles = [
        {
          id: 'qwen-local',
          providerId: 'missing',
          model: 'qwen',
          kind: 'text',
          contextWindow: 8192,
          maxOutputTokens: 512,
          structuredOutput: 'json-schema',
        },
      ];
      input.roles = { narrator: { profileId: 'ghost' } };
    });
    const issues = checkCrossReferences(config);
    expect(issues.map((issue) => issue.path)).toEqual([
      'providers.0.deviceId',
      'modelProfiles.0.providerId',
      'roles.narrator.profileId',
    ]);
    expect(issues[0]?.message).toContain('"nowhere"');
  });

  it('PRV-002: the embedder needs an embedding profile and other roles a text one', () => {
    const config = configWith((input) => {
      input.roles = {
        embedder: { profileId: 'qwen-local' },
        narrator: { profileId: 'embed-local' },
      };
    });
    expect(checkCrossReferences(config)).toEqual([
      {
        path: 'roles.narrator.profileId',
        message: 'the narrator role needs a text profile, not embedding',
      },
      {
        path: 'roles.embedder.profileId',
        message: 'the embedder role needs an embedding profile, not text',
      },
    ]);
  });

  it('PRV-002: explicitContentRoles are checked like roles', () => {
    const config = configWith((input) => {
      input.explicitContentRoles = { narrator: { profileId: 'ghost' } };
    });
    expect(paths(config)).toEqual(['explicitContentRoles.narrator.profileId']);
  });

  it('PRV-002: an embedding profile needs embeddingDimensions', () => {
    const config = configWith((input) => {
      const profiles = input.modelProfiles as Record<string, unknown>[];
      delete profiles[1]?.embeddingDimensions;
    });
    expect(paths(config)).toEqual(['modelProfiles.1.embeddingDimensions']);
  });

  it('PRV-002: ids must be unique within each list', () => {
    const config = configWith((input) => {
      input.devices = [
        { id: 'gpu', name: 'GPU' },
        { id: 'gpu', name: 'Another GPU' },
      ];
      input.providers = [
        { id: 'ollama-local', type: 'ollama', baseUrl: 'http://localhost:11434', deviceId: 'gpu' },
      ];
      input.roles = {};
    });
    expect(paths(config)).toContain('devices.1.id');
  });

  it('PRV-002: media picks resolve to a media profile of the right kind', () => {
    const config = configWith((input) => {
      input.providers = [
        ...(input.providers as unknown[]),
        { id: 'comfy', type: 'comfyui', baseUrl: 'http://localhost:8188', deviceId: 'macbook-gpu' },
      ];
      input.mediaProfiles = [
        { id: 'portraits', kind: 'image', providerId: 'comfy', workflow: 'portrait.json' },
        { id: 'voices', kind: 'speech-output', providerId: 'nowhere', model: 'kokoro' },
      ];
      input.media = {
        imageProfileId: 'voices',
        speechOutputProfileId: 'ghost',
        speechInput: { mode: 'server', profileId: null },
      };
    });
    expect(paths(config)).toEqual([
      'mediaProfiles.1.providerId',
      'media.imageProfileId',
      'media.speechOutputProfileId',
      'media.speechInput.profileId',
    ]);
  });
});
