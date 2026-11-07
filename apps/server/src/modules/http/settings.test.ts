import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ErrorResponseSchema,
  MachineConfigSchema,
  ProbeResultSchema,
  ProviderStatusSchema,
  SaveSettingsResultSchema,
  SECRET_PLACEHOLDER,
  SemanticIssueSchema,
} from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createArrival, createHttpSpace, type HttpStack, settledTurn, testConfig } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

const API_KEY = 'sk-live-do-not-send';
const IssuesSchema = z.object({ issues: z.array(SemanticIssueSchema) });

/** Test config plus a cloud provider with an inline key, which the stack never calls. */
function configWithKey() {
  const base = testConfig();
  return {
    ...base,
    providers: [
      { id: 'mock', type: 'mock', deviceId: 'gpu' },
      {
        id: 'cloud',
        type: 'openai-compatible',
        baseUrl: 'https://models.example/v1',
        deviceId: 'gpu',
        apiKey: { value: API_KEY },
      },
    ],
  };
}

const fileOf = (stack: HttpStack) =>
  readFileSync(path.join(stack.dataDir, 'machine-config.json'), 'utf8');

async function getSettings(stack: HttpStack) {
  const response = await stack.server.inject({ url: '/api/settings' });
  expect(response.statusCode).toBe(200);
  return MachineConfigSchema.parse(response.json());
}

describe('settings routes', () => {
  it('CON-111: GET /settings never holds an inline secret or the PIN hash', async () => {
    const stack = await space.stack({ config: configWithKey() });
    await stack.auth.setPin({ pin: '2468', localhostExempt: true });
    const response = await stack.server.inject({ url: '/api/settings' });
    expect(response.body).not.toContain(API_KEY);
    const settings = MachineConfigSchema.parse(response.json());
    expect(settings.providers[1]).toMatchObject({ apiKey: { value: SECRET_PLACEHOLDER } });
    expect(settings.server.pin?.hash).toBe(SECRET_PLACEHOLDER);
  });

  it('CON-111, PRV-003: saving the response back unchanged keeps every secret', async () => {
    const stack = await space.stack({ config: configWithKey() });
    await stack.auth.setPin({ pin: '2468', localhostExempt: true });
    const before = MachineConfigSchema.parse(JSON.parse(fileOf(stack)));

    const response = await stack.server.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: await getSettings(stack),
    });
    expect(response.statusCode).toBe(200);
    const saved = SaveSettingsResultSchema.parse(response.json());
    expect(JSON.stringify(saved)).not.toContain(API_KEY);
    expect(saved.restartRequired).toBe(false);
    expect(MachineConfigSchema.parse(JSON.parse(fileOf(stack)))).toEqual(before);
  });

  it('PRV-003, CON-091: an invalid save lists every issue and leaves the file as it was', async () => {
    const stack = await space.stack();
    const before = fileOf(stack);
    const settings = await getSettings(stack);
    const response = await stack.server.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...settings, devices: [], roles: { narrator: { profileId: 'missing' } } },
    });
    expect(response.statusCode).toBe(400);
    const { error } = ErrorResponseSchema.parse(response.json());
    expect(error.code).toBe('validation_failed');
    const paths = IssuesSchema.parse(error.details).issues.map((issue) => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['devices']));
    expect(fileOf(stack)).toBe(before);
  });

  it('PRV-004: a changed profile applies to the next narration, with no restart', async () => {
    const stack = await space.stack();
    const view = await createArrival(stack);
    await settledTurn(stack, view.campaignId, view.headTurnId);
    const settings = await getSettings(stack);
    const [profile] = settings.modelProfiles;
    if (profile === undefined) throw new Error('the test config has no profile');
    const saved = await stack.server.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...settings, modelProfiles: [{ ...profile, model: 'mock-2' }] },
    });
    expect(SaveSettingsResultSchema.parse(saved.json()).restartRequired).toBe(false);

    const submitted = await stack.server.inject({
      method: 'POST',
      url: `/api/campaigns/${view.campaignId}/actions`,
      payload: {
        branchId: view.currentBranchId,
        expectedHeadTurnId: view.headTurnId,
        mode: 'ic',
        text: 'I look around.',
      },
    });
    const { turnId } = z.object({ turnId: z.string() }).parse(submitted.json());
    await settledTurn(stack, view.campaignId, turnId);
    expect(stack.mock.requests.map((request) => request.profile.model)).toEqual([
      'mock-1',
      'mock-2',
    ]);
  });

  it('PRV-004: a changed port is saved, and the answer says it needs a restart', async () => {
    const stack = await space.stack();
    const settings = await getSettings(stack);
    const response = await stack.server.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { ...settings, server: { ...settings.server, port: 6001 } },
    });
    expect(SaveSettingsResultSchema.parse(response.json()).restartRequired).toBe(true);
  });

  it('ARCH-110: PUT /settings/pin sets the PIN, after which another device needs it', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({
      method: 'PUT',
      url: '/api/settings/pin',
      payload: { pin: '13579' },
    });
    expect(response.statusCode).toBe(204);
    const phone = await stack.server.inject({ url: '/api/packs', remoteAddress: '192.168.1.20' });
    expect(phone.statusCode).toBe(401);

    const tooShort = await stack.server.inject({
      method: 'PUT',
      url: '/api/settings/pin',
      payload: { pin: '12' },
    });
    expect(tooShort.statusCode).toBe(400);
  });

  it('PRV-091: GET /settings/providers gives each provider a status', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({ url: '/api/settings/providers' });
    const statuses = z.array(ProviderStatusSchema).parse(response.json());
    expect(statuses.map((status) => [status.providerId, status.health.reachable])).toEqual([
      ['mock', true],
    ]);
  });

  it('PRV-091: GET /settings/providers/:providerId/models lists the models, or not_found', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({ url: '/api/settings/providers/mock/models' });
    expect(response.json()).toEqual(['mock']);
    const unknown = await stack.server.inject({ url: '/api/settings/providers/none/models' });
    expect(unknown.statusCode).toBe(404);
  });

  it('PRV-090: POST /settings/profiles/:profileId/probe returns the probe result', async () => {
    const stack = await space.stack();
    const response = await stack.server.inject({
      method: 'POST',
      url: '/api/settings/profiles/mock-narrator/probe',
    });
    expect(response.statusCode).toBe(200);
    const result = ProbeResultSchema.parse(response.json());
    expect(result).toMatchObject({ profileId: 'mock-narrator', reachable: true });
    const unknown = await stack.server.inject({
      method: 'POST',
      url: '/api/settings/profiles/none/probe',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('PRV-002: while machine config fails to load, GET /settings lists its issues', async () => {
    const stack = await space.stack({ config: { schemaVersion: 1, devices: [] } });
    const response = await stack.server.inject({ url: '/api/settings' });
    expect(response.statusCode).toBe(400);
    const { error } = ErrorResponseSchema.parse(response.json());
    expect(error.code).toBe('validation_failed');
    expect(IssuesSchema.parse(error.details).issues.length).toBeGreaterThan(0);
  });
});
