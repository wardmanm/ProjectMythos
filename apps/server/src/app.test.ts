import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  type AppError,
  CampaignViewSchema,
  err,
  MachineConfigSchema,
  ok,
  type Result,
  type ServerEvent,
  ServerEventSchema,
  TurnViewSchema,
} from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contextDependencies, createServer, listenAddress, type MythosServer } from './app';

const NOW = Date.parse('2026-11-07T12:00:00.000Z');
const folders: string[] = [];
const servers: MythosServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** Machine config with the mock provider, pausing `delayMs` per word, as the narrator. */
function mockConfig(delayMs = 0) {
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers: [{ id: 'mock', type: 'mock', deviceId: 'gpu', delayMs }],
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
  });
}

function dataDirWith(config: unknown): string {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'mythos-app-'));
  folders.push(dataDir);
  writeFileSync(path.join(dataDir, 'machine-config.json'), JSON.stringify(config));
  return dataDir;
}

async function startServer(dataDir: string): Promise<MythosServer> {
  const server = await createServer({
    dataDirFlag: dataDir,
    portFlag: null,
    platform: process.platform,
    env: {},
    homedir: dataDir,
    cwd: dataDir,
    clientDir: null,
    logger: false,
    timeSource: { now: () => NOW },
  });
  servers.push(server);
  return server;
}

/** The events of an SSE body, read as they arrive; `until` waits for one that matches. */
function eventsOf(stream: Readable) {
  const events: ServerEvent[] = [];
  let buffer = '';
  const wake: (() => void)[] = [];
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      if (data !== undefined) events.push(ServerEventSchema.parse(JSON.parse(data.slice(6))));
    }
    for (const resolve of wake.splice(0)) resolve();
  });
  return {
    events,
    async until(matches: (event: ServerEvent) => boolean): Promise<void> {
      while (!events.some(matches)) await new Promise<void>((resolve) => wake.push(resolve));
    },
  };
}

const doneFor = (turnId: string) => (event: ServerEvent) =>
  event.payload.type === 'narration.done' && event.payload.turnId === turnId;

/** The text of every `narration.delta` a turn's stream sent, in order. */
function streamedText(events: ServerEvent[], turnId: string): string {
  return events
    .map((event) => event.payload)
    .filter((payload) => payload.type === 'narration.delta' && payload.turnId === turnId)
    .map((payload) => (payload.type === 'narration.delta' ? payload.text : ''))
    .join('');
}

describe('createServer', () => {
  it('ARCH-022: with the mock provider, the opening and an action narrate over SSE end to end', async () => {
    const server = await startServer(dataDirWith(mockConfig()));
    const app = server.fastify;
    const created = await app.inject({
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
    const base = `/api/campaigns/${view.campaignId}`;

    // The bus's first ID is the start time, so the ID before it replays everything.
    const stream = await app.inject({
      url: `${base}/events`,
      headers: { 'last-event-id': String(NOW - 1) },
      payloadAsStream: true,
    });
    const reader = eventsOf(stream.stream());
    await reader.until(doneFor(view.headTurnId));
    const opening = TurnViewSchema.parse(
      (await app.inject({ url: `${base}/turns/${view.headTurnId}` })).json(),
    );
    expect(opening.narration).toEqual({
      text: streamedText(reader.events, view.headTurnId),
      complete: true,
    });
    expect(opening.narration?.text).not.toBe('');

    const submitted = await app.inject({
      method: 'POST',
      url: `${base}/actions`,
      payload: {
        branchId: view.currentBranchId,
        expectedHeadTurnId: view.headTurnId,
        mode: 'ic',
        text: 'I step onto the quay.',
      },
    });
    const { turnId } = z.object({ turnId: z.string() }).parse(submitted.json());
    await reader.until(doneFor(turnId));
    const turn = TurnViewSchema.parse(
      (await app.inject({ url: `${base}/turns/${turnId}` })).json(),
    );
    expect(turn.input?.text).toBe('I step onto the quay.');
    expect(turn.narration).toEqual({ text: streamedText(reader.events, turnId), complete: true });
  });

  it('TRN-012: close() commits a running narration’s text before the databases close', async () => {
    const dataDir = dataDirWith(mockConfig(40));
    const first = await startServer(dataDir);
    const created = await first.fastify.inject({
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
    const url = `/api/campaigns/${view.campaignId}/turns/${view.headTurnId}`;
    const stream = await first.fastify.inject({
      url: `/api/campaigns/${view.campaignId}/events`,
      headers: { 'last-event-id': String(NOW - 1) },
      payloadAsStream: true,
    });
    await eventsOf(stream.stream()).until((event) => event.payload.type === 'narration.delta');
    await first.close();

    const second = await startServer(dataDir);
    const opening = TurnViewSchema.parse((await second.fastify.inject({ url })).json());
    expect(opening.turn.status).toBe('complete');
    expect(opening.narration?.complete).toBe(false);
    expect(opening.narration?.text).not.toBe('');
  });

  it('PRV-091: GET /settings/providers/:providerId/models asks the provider machine config names', async () => {
    const server = await startServer(dataDirWith(mockConfig()));
    const listed = await server.fastify.inject({ url: '/api/settings/providers/mock/models' });
    expect(listed.json()).toEqual(['mock']);
    const unknown = await server.fastify.inject({ url: '/api/settings/providers/none/models' });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('listenAddress', () => {
  it('ARCH-103: the host and port come from machine config, all interfaces by default', () => {
    expect(listenAddress(ok(mockConfig()), null)).toEqual({ host: '0.0.0.0', port: 5317 });
    const config = {
      ...mockConfig(),
      server: { ...mockConfig().server, host: '127.0.0.1', port: 6100 },
    };
    expect(listenAddress(ok(config), null)).toEqual({ host: '127.0.0.1', port: 6100 });
  });

  it('ARCH-103: --port wins over the config, and a config that failed to load uses the defaults', () => {
    expect(listenAddress(ok(mockConfig()), 7200)).toEqual({ host: '0.0.0.0', port: 7200 });
    const failed: Result<never, AppError> = err({ code: 'validation_failed', message: 'Broken.' });
    expect(listenAddress(failed, null)).toEqual({ host: '0.0.0.0', port: 5317 });
  });
});

describe('contextDependencies', () => {
  it('CTX-110: profileFor routes the role on the config in effect, with the calibrated ratio', () => {
    let config = mockConfig();
    const context = contextDependencies({
      config: { current: () => ok(config) },
      calibration: { charsPerToken: () => 3.1 },
      dataDir: tmpdir(),
    });
    const routed = context.profileFor('narrator', 'any-campaign');
    expect(routed.ok && [routed.value.profile.id, routed.value.charsPerToken]).toEqual([
      'mock-narrator',
      3.1,
    ]);

    config = { ...config, roles: { ...config.roles, narrator: null } };
    const unassigned = context.profileFor('narrator', 'any-campaign');
    expect(!unassigned.ok && unassigned.error.code).toBe('not_configured');
  });

  it('CTX-110: the context section is read fresh, with the defaults while the config fails', () => {
    let state: Result<z.infer<typeof MachineConfigSchema>, AppError> = ok(mockConfig());
    const context = contextDependencies({
      config: { current: () => state },
      calibration: { charsPerToken: () => 4 },
      dataDir: tmpdir(),
    });
    const changed = { ...mockConfig().context, transcriptChunkTurns: 3 };
    state = ok({ ...mockConfig(), context: changed });
    expect(context.contextSettings()).toEqual(changed);
    state = err({ code: 'validation_failed', message: 'Broken.' });
    expect(context.contextSettings()).toEqual(mockConfig().context);
  });

  it('CTX-110: a profile’s template folder is found in the data directory, or null', () => {
    const dataDir = dataDirWith(mockConfig());
    const context = contextDependencies({
      config: { current: () => ok(mockConfig()) },
      calibration: { charsPerToken: () => 4 },
      dataDir,
    });
    expect(context.profileTemplateDir('mock-narrator')).toBeNull();
    const folder = path.join(dataDir, 'library', 'templates', 'profiles', 'mock-narrator');
    mkdirSync(folder, { recursive: true });
    expect(context.profileTemplateDir('mock-narrator')).toBe(folder);
  });
});
