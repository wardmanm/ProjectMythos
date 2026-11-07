import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CampaignViewSchema, TurnViewSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createServer, type MythosServer } from '../app';
import { rebuildProjectionsCommand } from './rebuild-projections';

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** A data directory whose machine config has the mock provider as the narrator. */
function dataDir(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'mythos-cli-'));
  folders.push(folder);
  const config = {
    schemaVersion: 1,
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers: [{ id: 'mock', type: 'mock', deviceId: 'gpu' }],
    modelProfiles: [
      {
        id: 'mock-narrator',
        providerId: 'mock',
        model: 'mock-1',
        kind: 'text',
        contextWindow: 32768,
        maxOutputTokens: 2048,
        structuredOutput: 'json-schema',
      },
    ],
    roles: { narrator: { profileId: 'mock-narrator' } },
  };
  writeFileSync(path.join(folder, 'machine-config.json'), JSON.stringify(config));
  return folder;
}

const where = (folder: string) => ({
  platform: process.platform,
  env: {},
  homedir: folder,
  cwd: folder,
});

function start(folder: string): Promise<MythosServer> {
  return createServer({
    ...where(folder),
    dataDirFlag: folder,
    portFlag: null,
    clientDir: null,
    logger: false,
  });
}

/** Turn views read through the server, once the turn's narration has settled. */
async function settledTurns(server: MythosServer, campaignId: string, branchId: string) {
  const url = `/api/campaigns/${campaignId}/branches/${branchId}/turns`;
  for (;;) {
    const views = z.array(TurnViewSchema).parse((await server.fastify.inject({ url })).json());
    if (views.every((view) => view.turn.status !== 'narrating')) return views;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** A campaign with its opening and one action played, then the server closed. */
async function playedCampaign(folder: string) {
  const server = await start(folder);
  const created = await server.fastify.inject({
    method: 'POST',
    url: '/api/campaigns',
    payload: {
      name: 'Brinemoor',
      packId: 'reference',
      scenarioId: 'scenario.arrival',
      toneProfileId: 'tone.coastal-mystery',
      rulesetId: 'ruleset.standard',
      conversion: null,
      pc: { mode: 'premade' },
    },
  });
  const view = CampaignViewSchema.parse(created.json());
  await settledTurns(server, view.campaignId, view.currentBranchId);
  await server.fastify.inject({
    method: 'POST',
    url: `/api/campaigns/${view.campaignId}/actions`,
    payload: {
      branchId: view.currentBranchId,
      expectedHeadTurnId: view.headTurnId,
      mode: 'ic',
      text: 'I wave.',
    },
  });
  const turns = await settledTurns(server, view.campaignId, view.currentBranchId);
  await server.close();
  return { view, turns };
}

describe('rebuild-projections', () => {
  it('ARCH-042, ARCH-007: one command rebuilds every campaign, and play reads the same after', async () => {
    const folder = dataDir();
    const { view, turns } = await playedCampaign(folder);
    expect(turns).toHaveLength(2);

    const printed: string[] = [];
    const code = await rebuildProjectionsCommand(['--data-dir', folder], where(folder), (line) =>
      printed.push(line),
    );
    expect(code).toBe(0);
    expect(printed).toEqual([`Rebuilt the projections of campaign ${view.campaignId}.`]);

    const server = await start(folder);
    try {
      expect(await settledTurns(server, view.campaignId, view.currentBranchId)).toEqual(turns);
    } finally {
      await server.close();
    }
  });

  it('ARCH-042: an unknown campaign is reported, and the command fails', async () => {
    const folder = dataDir();
    const missing = randomUUID();
    const printed: string[] = [];
    const code = await rebuildProjectionsCommand(
      ['--', '--data-dir', folder, missing],
      where(folder),
      (line) => printed.push(line),
    );
    expect(code).toBe(1);
    expect(printed).toEqual([`Could not rebuild campaign ${missing}: No campaign ${missing}.`]);
  });

  it('ARCH-007: an unknown flag prints the usage and fails without opening anything', async () => {
    const printed: string[] = [];
    const code = await rebuildProjectionsCommand(['--everything'], where(tmpdir()), (line) =>
      printed.push(line),
    );
    expect(code).toBe(1);
    expect(printed.at(-1)).toMatch(/^Usage: /);
  });
});
