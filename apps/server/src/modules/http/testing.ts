// Helpers for the http module's tests only, not exported from index.ts. A stack is the
// real modules, built from their public APIs (ARCH-020) on a fresh data directory, with
// one scriptable mock behind every model call, the http module installed on a Fastify
// instance, and wall time and timers the test controls. The composition root wires the
// same modules for real (`app.ts`), which its own tests cover.
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  type CampaignView,
  CampaignViewSchema,
  type CreateCampaignCommand,
  err,
  ok,
  type ServerEvent,
  ServerEventSchema,
  type ServerEventPayload,
  type TimeSource,
  type TurnView,
  TurnViewSchema,
} from '@mythos/contracts';
import { fastify, type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type Auth, createAuth } from '../auth';
import { type ConfigStore, openConfig } from '../config';
import { createContent, defaultSources } from '../content';
import type { ContextDependencies } from '../context';
import { createEventBus, type EventBus } from '../events';
import {
  type Calibration,
  createHealthCheck,
  createJobQueue,
  createMockAdapter,
  createModelCalls,
  createProbe,
  type MockAdapter,
  routeRole,
  type SetTimer,
} from '../providers';
import { type CampaignStore, createCampaignStore } from '../storage';
import { createNarrations, type Narrations } from '../turn';
import { installHttp } from './index';

export const TEST_NOW = Date.parse('2026-11-07T12:00:00.000Z');

/** Machine config with the mock provider and one narrator profile, `mock-narrator`. */
export function testConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
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
    ...overrides,
  };
}

/** The reference pack's first campaign, as the new-campaign screen sends it. */
export function arrivalCommand(overrides: Partial<CreateCampaignCommand> = {}) {
  return {
    name: 'Brinemoor',
    packId: 'reference',
    scenarioId: 'scenario.arrival',
    toneProfileId: 'tone.coastal-mystery',
    rulesetId: 'ruleset.standard',
    conversion: null,
    pc: { mode: 'premade' },
    ...overrides,
  };
}

/** A timer the code under test started, which the test fires by hand. */
export type TestTimer = { ms: number; fire: () => void };

const LogLineSchema = z.object({ level: z.number(), msg: z.string() }).loose();

export type HttpStack = {
  server: FastifyInstance;
  dataDir: string;
  mock: MockAdapter;
  config: ConfigStore;
  auth: Auth;
  store: CampaignStore;
  bus: EventBus;
  narrations: Narrations;
  /** Timers waiting to fire: keep-alives, backoffs, and health timeouts. */
  timers: Set<TestTimer>;
  /** Every route registered, as `METHOD /url`, HEAD routes included. */
  routes: string[];
  /** Moves wall time on. */
  advance: (ms: number) => void;
  /** Every line logged, parsed. */
  logs: () => z.infer<typeof LogLineSchema>[];
};

export type StackOptions = {
  /** The machine config file's content: `testConfig()` unless given. */
  config?: unknown;
  /** The built client's folder; none unless given. */
  clientDir?: string | null;
  /** The mock's pause after each streamed word, so a test can act mid-narration. */
  mockDelayMs?: number;
};

/** What the context module gets: routing and settings read from the live config. */
function contextFrom(config: ConfigStore): ContextDependencies {
  return {
    profileFor: (role) => {
      const current = config.current();
      if (!current.ok) return current;
      const route = routeRole(current.value, role);
      if (!route.ok) return route;
      return ok({ profile: route.value.profile, charsPerToken: route.value.profile.charsPerToken });
    },
    contextSettings: () => {
      const current = config.current();
      if (!current.ok) throw new Error('the test config failed to load');
      return current.value.context;
    },
    profileTemplateDir: () => null,
  };
}

async function buildStack(dataDir: string, options: StackOptions): Promise<HttpStack> {
  const file = path.join(dataDir, 'machine-config.json');
  writeFileSync(file, JSON.stringify(options.config ?? testConfig(), null, 2));
  const env = {};
  const where = { dataDirFlag: dataDir, platform: process.platform, env, homedir: dataDir };
  const { store: config } = await openConfig({ ...where, cwd: dataDir });

  const lines: string[] = [];
  const stream = {
    write: (line: string) => {
      lines.push(line);
    },
  };
  const server = fastify({ logger: { level: 'info', stream } });
  const logger = server.log;
  let now = TEST_NOW;
  const timeSource: TimeSource = { now: () => now };
  const timers = new Set<TestTimer>();
  const setTimer: SetTimer = (ms, callback) => {
    const timer: TestTimer = {
      ms,
      fire: () => {
        timers.delete(timer);
        callback();
      },
    };
    timers.add(timer);
    return () => {
      timers.delete(timer);
    };
  };

  const store = createCampaignStore({
    dataDir,
    timeSource,
    modelCallRecordDays: () => null,
  });
  const bus = createEventBus({ firstId: 1 });
  const publish = (campaignId: string, payload: ServerEventPayload) =>
    bus.publish(campaignId, payload);
  const delayMs = options.mockDelayMs ?? 0;
  const mock = createMockAdapter({ id: 'mock', type: 'mock', deviceId: 'gpu', delayMs });
  const adapterFor = () => mock;
  const queue = createJobQueue({ config, campaigns: store, publish, timeSource, setTimer, logger });
  const calibration: Calibration = {
    charsPerToken: (profile) => profile.charsPerToken,
    calibrate: () => Promise.resolve(),
  };
  const campaigns = store;
  const modelCalls = { config, queue, adapterFor, campaigns, calibration, timeSource, logger };
  const { streamText } = createModelCalls(modelCalls);
  const newId = () => randomUUID();
  const context = contextFrom(config);
  const narrations = createNarrations({
    store,
    publish,
    streamText,
    context,
    timeSource,
    newId,
    logger,
  });
  const auth = createAuth({ config, timeSource, secureCookies: false });

  const routes: string[] = [];
  server.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) routes.push(`${method} ${route.url}`);
  });
  await installHttp(server, {
    config,
    auth,
    content: createContent({ sources: defaultSources(dataDir), logger }),
    bus,
    turn: { store, publish, timeSource, newId, logger, narrations },
    probe: createProbe({ config, queue, adapterFor, timeSource }),
    health: createHealthCheck({ config, adapterFor, setTimer, logger }),
    listModels: (providerId, signal) =>
      providerId === 'mock'
        ? mock.listModels(signal)
        : Promise.resolve(err({ code: 'not_found', message: `No provider ${providerId}.` })),
    clientDir: options.clientDir ?? null,
    setTimer,
  });
  server.addHook('preClose', async () => {
    await narrations.stop();
    await queue.stop();
  });
  server.addHook('onClose', (_instance, done) => {
    store.closeAll();
    done();
  });
  await server.ready();

  return {
    server,
    dataDir,
    mock,
    config,
    auth,
    store,
    bus,
    narrations,
    timers,
    routes,
    advance: (ms) => {
      now += ms;
    },
    logs: () => lines.map((line) => LogLineSchema.parse(JSON.parse(line))),
  };
}

/**
 * Tracks the folders and stacks a test file makes. `cleanUp`, awaited in `afterEach`,
 * closes each server, which stops its narrations and queue and closes its databases,
 * before removing the folders (CONV-116).
 */
export function createHttpSpace() {
  const folders: string[] = [];
  const stacks: HttpStack[] = [];

  return {
    /** A new, empty folder in os.tmpdir(). */
    folder(): string {
      const folder = mkdtempSync(path.join(tmpdir(), 'mythos-http-'));
      folders.push(folder);
      return folder;
    },
    async stack(options: StackOptions = {}): Promise<HttpStack> {
      const stack = await buildStack(this.folder(), options);
      stacks.push(stack);
      return stack;
    },
    async cleanUp(): Promise<void> {
      for (const stack of stacks.splice(0)) await stack.server.close();
      for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
    },
  };
}

/** Creates the reference campaign through the route, and returns its view. */
export async function createArrival(stack: HttpStack): Promise<CampaignView> {
  const response = await stack.server.inject({
    method: 'POST',
    url: '/api/campaigns',
    payload: arrivalCommand(),
  });
  if (response.statusCode !== 200) throw new Error(response.body);
  return CampaignViewSchema.parse(response.json());
}

/** The turn's view, read through the route, once its narration has settled. */
export async function settledTurn(
  stack: HttpStack,
  campaignId: string,
  turnId: string,
): Promise<TurnView> {
  for (let tries = 0; tries < 2000; tries += 1) {
    const response = await stack.server.inject({
      url: `/api/campaigns/${campaignId}/turns/${turnId}`,
    });
    const view = TurnViewSchema.parse(response.json());
    if (view.turn.status !== 'narrating') return view;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`turn ${turnId} never settled`);
}

/** One frame of an event stream: its `id`, `event`, and `data` lines, and any comment. */
export type Frame = {
  id: string | null;
  event: string | null;
  data: string | null;
  comment: string | null;
};

function parseFrame(text: string): Frame {
  const frame: Frame = { id: null, event: null, data: null, comment: null };
  for (const line of text.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('data: ')) frame.data = line.slice(6);
  }
  return frame;
}

/**
 * Reads an event stream as it arrives. `frames` holds every whole frame so far;
 * `waitFor` resolves with the first event, among all read so far or still to come, that
 * matches, and rejects if the stream ends first.
 */
export function frameReader(stream: Readable) {
  const frames: Frame[] = [];
  let buffer = '';
  let ended = false;
  const wake: (() => void)[] = [];
  const notify = () => {
    for (const resolve of wake.splice(0)) resolve();
  };
  stream.setEncoding('utf8');
  stream.on('data', (chunk: string) => {
    buffer += chunk;
    let end = buffer.indexOf('\n\n');
    while (end !== -1) {
      frames.push(parseFrame(buffer.slice(0, end)));
      buffer = buffer.slice(end + 2);
      end = buffer.indexOf('\n\n');
    }
    notify();
  });
  stream.on('end', () => {
    ended = true;
    notify();
  });

  const events = (): ServerEvent[] =>
    frames.flatMap((frame) =>
      frame.data === null ? [] : [ServerEventSchema.parse(JSON.parse(frame.data))],
    );

  return {
    frames,
    events,
    ended: () => ended,
    async waitFor(matches: (event: ServerEvent) => boolean): Promise<ServerEvent> {
      for (;;) {
        const found = events().find(matches);
        if (found !== undefined) return found;
        if (ended) throw new Error('the event stream ended first');
        await new Promise<void>((resolve) => wake.push(resolve));
      }
    },
  };
}
