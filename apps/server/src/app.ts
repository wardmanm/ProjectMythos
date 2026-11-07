// The composition root (ARCH-022): the one place modules are built and wired together.
// Each module gets its dependencies as parameters; nothing here holds game logic. The
// server, and the command-line tools in `cli/` (ARCH-007), get their modules from here.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type AppError,
  err,
  MachineConfigSchema,
  ok,
  type ProviderConfig,
  type Result,
  type ServerEventPayload,
  type TimeSource,
} from '@mythos/contracts';
import {
  fastify,
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import { createAuth } from './modules/auth';
import { type ConfigState, type ConfigStore, type DataDirEnv, openConfig } from './modules/config';
import { createContent, defaultSources } from './modules/content';
import type { ContextDependencies } from './modules/context';
import { createEventBus } from './modules/events';
import { installHttp } from './modules/http';
import {
  type Calibration,
  createAdapter,
  createHealthCheck,
  createJobQueue,
  createModelCalls,
  createProbe,
  openCalibration,
  routeRole,
  type SetTimer,
} from './modules/providers';
import { createCampaignStore, rebuildProjections } from './modules/storage';
import { createNarrations, recoverInterruptedTurns } from './modules/turn';

/** Where machine config and the data directory are found (ARCH-030, PRV-001). */
export type ConfigOptions = {
  /** The `--data-dir` flag, or null. */
  dataDirFlag: string | null;
  platform: NodeJS.Platform;
  env: DataDirEnv;
  homedir: string;
  cwd: string;
};

export type ServerOptions = ConfigOptions & {
  /** The `--port` flag, or null for machine config's port (ARCH-103). */
  portFlag: number | null;
  /** The built client: `apps/client/dist` unless given; null serves the API alone. */
  clientDir?: string | null;
  /** Fastify's logger option: pino's settings, or false for none. Stdout by default. */
  logger?: FastifyServerOptions['logger'];
  /** Wall time: the real clock unless a test fixes it (CONV-061). */
  timeSource?: TimeSource;
};

export type MythosServer = {
  /** The Fastify instance, for `inject` in tests. */
  fastify: FastifyInstance;
  dataDir: string;
  /** Starts listening at `listenAddress`, and returns the address. */
  listen: () => Promise<string>;
  /** Stops accepting requests, stops narrations and the queue, then closes every database. */
  close: () => Promise<void>;
};

/** The client Vite builds, found from this file's own place: `apps/server/src/app.ts`. */
const DEFAULT_CLIENT_DIR = fileURLToPath(new URL('../../client/dist/', import.meta.url));

/** Machine config's `server` and `context` sections as the schema's defaults fill them. */
const DEFAULT_SERVER = MachineConfigSchema.shape.server.parse(undefined);
const DEFAULT_CONTEXT = MachineConfigSchema.shape.context.parse(undefined);

const realTime: TimeSource = { now: () => Date.now() };

/** The backoff, health, and keep-alive timer, on Node's `setTimeout`. */
const setTimer: SetTimer = (ms, callback) => {
  const timer = setTimeout(callback, ms);
  return () => {
    clearTimeout(timer);
  };
};

/**
 * The host and port to listen on: machine config's `server` section, with `--port`
 * over its port. While the config fails to load the schema's defaults apply, so the
 * owner can still reach Settings on the host. Implements ARCH-103.
 */
export function listenAddress(
  config: ConfigState,
  portFlag: number | null,
): { host: string; port: number } {
  const server = config.ok ? config.value.server : DEFAULT_SERVER;
  return { host: server.host, port: portFlag ?? server.port };
}

/** Machine config's record retention; nothing is pruned while the config fails to load. */
function recordDays(config: Pick<ConfigStore, 'current'>): number | null {
  const current = config.current();
  return current.ok ? current.value.retention.modelCallRecordDays : null;
}

/**
 * What the context module gets in place of `config` and `providers` (CTX-110): the
 * profile a role's call will use, with its calibrated ratio, and machine config's
 * `context` section, both read fresh each time (PRV-004), and the model profile's
 * template folder (CTX-004). The campaign's explicit-content routing (PRV-006) arrives
 * with `routeRole`'s, in phase 3. Implements CTX-110.
 */
export function contextDependencies(options: {
  config: Pick<ConfigStore, 'current'>;
  calibration: Pick<Calibration, 'charsPerToken'>;
  dataDir: string;
}): ContextDependencies {
  const { config, calibration, dataDir } = options;
  return {
    profileFor: (role) => {
      const current = config.current();
      if (!current.ok) return current;
      const route = routeRole(current.value, role);
      if (!route.ok) return route;
      const { profile } = route.value;
      return ok({ profile, charsPerToken: calibration.charsPerToken(profile) });
    },
    contextSettings: () => {
      const current = config.current();
      return current.ok ? current.value.context : DEFAULT_CONTEXT;
    },
    profileTemplateDir: (profileId) => {
      const folder = path.join(dataDir, 'library', 'templates', 'profiles', profileId);
      return existsSync(folder) ? folder : null;
    },
  };
}

/** `GET /settings/providers/:providerId/models`: the registry's adapter for a configured provider. */
function modelLister(
  config: Pick<ConfigStore, 'current'>,
  adapterFor: (provider: ProviderConfig) => ReturnType<typeof createAdapter>,
) {
  return async (providerId: string, signal: AbortSignal): Promise<Result<string[], AppError>> => {
    const current = config.current();
    if (!current.ok) return current;
    const provider = current.value.providers.find((candidate) => candidate.id === providerId);
    if (provider === undefined) {
      return err({ code: 'not_found', message: `Machine config has no provider ${providerId}.` });
    }
    return adapterFor(provider).listModels(signal);
  };
}

function logConfig(logger: FastifyBaseLogger, config: ConfigStore, created: boolean): void {
  if (created) logger.info({ configPath: config.configPath }, 'wrote the default machine config');
  const current = config.current();
  if (!current.ok) {
    // The issues name paths and problems, never values, so no secret is logged (CONV-072).
    logger.warn(
      { configPath: config.configPath, details: current.error.details },
      'machine config failed to load: only this computer can use Mythos until it is fixed',
    );
  }
}

/**
 * The modules play runs on, built in dependency order from their public APIs:
 * campaigns, the event bus, adapters, the job queue, model calls, and narrations.
 */
async function playModules(config: ConfigStore, options: ServerOptions, logger: FastifyBaseLogger) {
  const timeSource = options.timeSource ?? realTime;
  const { dataDir } = config;
  const { calibration, problem } = await openCalibration(dataDir);
  if (problem !== null) {
    logger.warn({ problem }, 'the calibration file was unreadable, so it starts again');
  }
  const store = createCampaignStore({
    dataDir,
    timeSource,
    modelCallRecordDays: () => recordDays(config),
  });
  const bus = createEventBus({ firstId: timeSource.now() });
  const publish = (campaignId: string, payload: ServerEventPayload) =>
    bus.publish(campaignId, payload);
  const adapterFor = (provider: ProviderConfig) =>
    createAdapter(provider, { env: options.env, timeSource });
  const queue = createJobQueue({ config, campaigns: store, publish, timeSource, setTimer, logger });
  const { streamText } = createModelCalls({
    config,
    queue,
    adapterFor,
    campaigns: store,
    calibration,
    timeSource,
    logger,
  });
  const context = contextDependencies({ config, calibration, dataDir });
  const newId = () => randomUUID();
  const narrations = createNarrations({
    store,
    publish,
    streamText,
    context,
    timeSource,
    newId,
    logger,
  });
  return { timeSource, store, bus, publish, adapterFor, queue, newId, narrations };
}

/**
 * Builds the server: every module, then the http module on top. Interrupted turns are
 * recovered before any request (TRN-012). On `close()`, Fastify refuses new requests;
 * then the event streams end, narrations and the queue stop (cancelling interactive
 * jobs), in-flight requests finish, and every database closes. Every module reads machine
 * config through the one `ConfigStore`, so a saved change applies to the next call
 * (PRV-004). Implements ARCH-022 and PRV-004.
 */
export async function createServer(options: ServerOptions): Promise<MythosServer> {
  const { store: config, created } = await openConfig(options);
  const server = fastify({ logger: options.logger ?? true });
  const logger = server.log;
  logConfig(logger, config, created);
  const play = await playModules(config, options, logger);
  const { timeSource, store, queue, adapterFor, narrations } = play;

  const recovered = await recoverInterruptedTurns({ store, logger });
  if (recovered > 0) {
    logger.info({ recovered }, 'turns interrupted by the last shutdown are marked failed');
  }
  // Phase 1 has no background job types to register before resuming (PRV-062).
  await queue.resume();

  await installHttp(server, {
    config,
    auth: createAuth({ config, timeSource, secureCookies: false }),
    content: createContent({ sources: defaultSources(config.dataDir), logger }),
    bus: play.bus,
    turn: { store, publish: play.publish, timeSource, newId: play.newId, logger, narrations },
    probe: createProbe({ config, queue, adapterFor, timeSource }),
    health: createHealthCheck({ config, adapterFor, setTimer, logger }),
    listModels: modelLister(config, adapterFor),
    clientDir: options.clientDir === undefined ? DEFAULT_CLIENT_DIR : options.clientDir,
    setTimer,
  });
  // Narrations stop before the queue, so partial narration is committed
  // (06-turn-engine Decisions); the databases close once in-flight requests are done.
  server.addHook('preClose', async () => {
    await narrations.stop();
    await queue.stop();
  });
  server.addHook('onClose', (_instance, done) => {
    store.closeAll();
    done();
  });
  return {
    fastify: server,
    dataDir: config.dataDir,
    listen: () => server.listen(listenAddress(config.current(), options.portFlag)),
    close: () => server.close(),
  };
}

/** What the command-line tools may do to campaigns (ARCH-007). */
export type CampaignTools = {
  dataDir: string;
  /** Every campaign's ID, sorted. */
  campaignIds: () => Promise<string[]>;
  /** Rebuilds one campaign's projections from its event log (ARCH-042). */
  rebuildProjections: (campaignId: string) => Result<void, AppError>;
  /** Closes every database the tools opened. */
  close: () => void;
};

/** The campaign store alone, for the command-line tools: no server, queue, or models. */
export async function openCampaignTools(options: ConfigOptions): Promise<CampaignTools> {
  const { store: config } = await openConfig(options);
  const store = createCampaignStore({
    dataDir: config.dataDir,
    timeSource: realTime,
    modelCallRecordDays: () => recordDays(config),
  });
  return {
    dataDir: config.dataDir,
    campaignIds: () => store.listCampaigns(),
    rebuildProjections: (campaignId) => {
      const opened = store.openCampaign(campaignId);
      if (!opened.ok) return opened;
      rebuildProjections(opened.value);
      return ok(undefined);
    },
    close: () => {
      store.closeAll();
    },
  };
}
