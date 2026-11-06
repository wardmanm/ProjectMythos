// Helpers for the model calls' tests: a real job queue and a campaign in a fresh
// os.tmpdir() folder, the mock adapter behind every provider, machine config with one
// profile, and a calibration that only remembers what it is given. Not exported from
// index.ts.
import {
  type ChatMessage,
  type Job,
  type MachineConfig,
  MachineConfigSchema,
  type ModelCallRecord,
  type ModelProfileSchema,
  ok,
} from '@mythos/contracts';
import { z } from 'zod';
import { createEventBus } from '../events';
import { readModelCall } from '../storage';
import { createMockAdapter } from './mock-adapter';
import { createJobQueue } from './queue';
import { createFakeTimer, createQueueSpace, newCampaign, recordingLogger } from './queue-testing';
import { createModelCalls, type PromptReport } from './structured';
import type { Calibration } from './tokens';

type RolesInput = z.input<typeof MachineConfigSchema>['roles'];

export type CallSetup = {
  /** Changes to the one profile, `test-model`, whose method defaults to `json-schema`. */
  profile?: Partial<z.input<typeof ModelProfileSchema>>;
  /** The provider's type. The mock answers either way; `anthropic` changes adaptation. */
  providerType?: 'mock' | 'anthropic';
  /** Defaults to the adjudicator and narrator on `test-model`. */
  roles?: RolesInput;
};

/** A report with nothing in it, as a call with no context-module prompt has. */
export const emptyReport: PromptReport = { tiers: [], retrieved: [], templates: [] };

/** A small prompt in the CTX-010 layout: system messages first. */
export const testMessages: ChatMessage[] = [
  { role: 'system', content: 'You are the GM.' },
  { role: 'user', content: 'The player looks around the harbour.' },
];

function callConfig(setup: CallSetup): MachineConfig {
  const provider =
    setup.providerType === 'anthropic'
      ? { id: 'cloud', type: 'anthropic', deviceId: 'gpu', apiKey: { value: 'test-key' } }
      : { id: 'mock', type: 'mock', deviceId: 'gpu' };
  return MachineConfigSchema.parse({
    schemaVersion: 1,
    devices: [{ id: 'gpu', name: 'GPU' }],
    providers: [provider],
    modelProfiles: [
      {
        id: 'test-model',
        providerId: provider.id,
        model: 'test-model-1',
        kind: 'text',
        contextWindow: 8192,
        maxOutputTokens: 512,
        structuredOutput: 'json-schema',
        ...setup.profile,
      },
    ],
    roles: setup.roles ?? {
      adjudicator: { profileId: 'test-model' },
      narrator: { profileId: 'test-model' },
    },
  });
}

const IdRowsSchema = z.array(z.object({ id: z.string() }));

/**
 * Tracks what a test file makes; `cleanUp` (run in `afterEach`) closes every database
 * before removing its folder.
 */
export function createCallSpace() {
  const space = createQueueSpace();

  /** Model calls on a new campaign, with everything a test looks at afterwards. */
  async function calls(setup: CallSetup = {}) {
    const store = space.store();
    const campaignId = await newCampaign(store);
    const config = callConfig(setup);
    const configStore = { current: () => ok(config) };
    const timer = createFakeTimer();
    const { logger, entries } = recordingLogger();
    const bus = createEventBus({ firstId: 1 });
    const jobs: Job[] = [];
    const queue = createJobQueue({
      config: configStore,
      campaigns: store,
      publish: (id, payload) => {
        if (payload.type === 'job.updated') jobs.push(payload.job);
        return bus.publish(id, payload);
      },
      timeSource: timer.timeSource,
      setTimer: timer.setTimer,
      logger,
    });
    const mock = createMockAdapter({ id: 'mock', type: 'mock', deviceId: 'gpu', delayMs: 0 });
    const calibrated: { profileId: string; estimated: number; reported: number }[] = [];
    const calibration: Calibration = {
      charsPerToken: (profile) => profile.charsPerToken,
      calibrate: (profile, estimated, reported) => {
        calibrated.push({ profileId: profile.id, estimated, reported });
        return Promise.resolve();
      },
    };
    const modelCalls = createModelCalls({
      config: configStore,
      queue,
      adapterFor: () => mock,
      campaigns: store,
      calibration,
      timeSource: timer.timeSource,
      logger,
    });

    /** Every record stored for the campaign, oldest first, each read back through storage. */
    function records(): ModelCallRecord[] {
      const db = store.openCampaign(campaignId);
      if (!db.ok) throw new Error(db.error.message);
      const rows = IdRowsSchema.parse(
        db.value.prepare('SELECT id FROM model_calls ORDER BY seq').all(),
      );
      return rows.map(({ id }) => {
        const record = readModelCall(db.value, id);
        if (record === null) throw new Error(`Record ${id} vanished.`);
        return record;
      });
    }

    /** How many rows a campaign table holds. */
    function countRows(table: 'commits' | 'commit_sets' | 'model_calls'): number {
      const db = store.openCampaign(campaignId);
      if (!db.ok) throw new Error(db.error.message);
      const rows = db.value.prepare(`SELECT COUNT(*) AS count FROM ${table}`).all();
      return z.array(z.object({ count: z.number() })).parse(rows)[0]?.count ?? 0;
    }

    return {
      ...modelCalls,
      mock,
      queue,
      timer,
      jobs,
      logEntries: entries,
      calibrated,
      campaignId,
      store,
      records,
      countRows,
    };
  }

  return {
    calls,
    cleanUp: (): void => {
      space.cleanUp();
    },
  };
}
