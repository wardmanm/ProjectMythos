// Helpers for the play tests only: the reference campaign played through the real stack,
// built from public APIs alone (ARCH-020): the event bus, the job queue with a timer the
// test fires, the mock adapter behind model calls, and the context module. Every event
// published is recorded. Not exported from index.ts.
import {
  MachineConfigSchema,
  type ModelProfileSchema,
  ok,
  type ServerEvent,
  type ServerEventPayload,
  type TurnStatus,
} from '@mythos/contracts';
import type { z } from 'zod';
import type { ContextDependencies } from '../context';
import { createEventBus } from '../events';
import {
  type Calibration,
  createJobQueue,
  createMockAdapter,
  createModelCalls,
  type MockOutcome,
  mockProviderError,
  mockResponse,
  type ProviderError,
  routeRole,
  type StreamText,
  type TextResponse,
} from '../providers';
import type { Database } from '../storage';
import { createCampaign } from './create-campaign';
import type { TurnDeps } from './deps';
import { createNarrations } from './narration';
import { submitAction } from './submit-action';
import { arrivalCommand, createTestSpace } from './testing';

type ProfileInput = Partial<z.input<typeof ModelProfileSchema>>;

export type PlayOptions = {
  /** Changes to the narrator's profile, `mock-narrator`. */
  profile?: ProfileInput;
  /** False leaves the narrator role unassigned (PRV-001). */
  narratorAssigned?: boolean;
  /** Wraps the real `streamText`, to act at the moment narration calls the model. */
  wrapStreamText?: (real: StreamText) => StreamText;
};

/** A scripted answer from the mock. */
export function answer(
  text: string,
  overrides: Partial<Omit<TextResponse, 'text'>> = {},
): MockOutcome {
  return { type: 'response', response: mockResponse(text, overrides) };
}

/** A scripted provider error, after `partialText` streams when there is some. */
export function failure(code: ProviderError['code'], partialText?: string): MockOutcome {
  const error = mockProviderError(code);
  return partialText === undefined
    ? { type: 'error', error }
    : { type: 'error', error, partialText };
}

/** Statuses a narration settles in. */
const SETTLED: readonly TurnStatus[] = ['complete', 'stage-failed', 'abandoned'];

type StatusEvent = Extract<ServerEventPayload, { type: 'turn.status' }>;

/** Machine config with the mock provider and one narrator profile, `mock-narrator`. */
function playConfig(profile: ProfileInput, narratorAssigned: boolean) {
  return MachineConfigSchema.parse({
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
        ...profile,
      },
    ],
    roles: narratorAssigned ? { narrator: { profileId: 'mock-narrator' } } : {},
  });
}

/**
 * Everything a play test needs, on a new data directory. `onEvent` runs after each
 * event, in a microtask, so a test can act in the middle of a stream: before the mock's
 * next word, and outside the publish that announced it.
 */
export function playStack(space: ReturnType<typeof createTestSpace>, options: PlayOptions = {}) {
  const base = space.deps();
  const { store, content, timeSource, newId, logger } = base;
  const config = playConfig(options.profile ?? {}, options.narratorAssigned ?? true);
  const configStore = { current: () => ok(config) };
  const bus = createEventBus({ firstId: 1 });
  const events: ServerEventPayload[] = [];
  const waiters: (() => boolean)[] = [];
  let onEvent: ((payload: ServerEventPayload) => void) | null = null;

  const publish = (campaignId: string, payload: ServerEventPayload): ServerEvent => {
    const event = bus.publish(campaignId, payload);
    events.push(payload);
    const listener = onEvent;
    if (listener !== null) {
      queueMicrotask(() => {
        listener(payload);
      });
    }
    for (const waiter of waiters.splice(0)) if (!waiter()) waiters.push(waiter);
    return event;
  };

  /** Backoff timers the queue started, for a test to fire (PRV-063). */
  const timers: (() => void)[] = [];
  const queue = createJobQueue({
    config: configStore,
    campaigns: store,
    publish,
    timeSource,
    setTimer: (_ms, callback) => {
      timers.push(callback);
      return () => {
        timers.splice(timers.indexOf(callback), 1);
      };
    },
    logger,
  });
  const mock = createMockAdapter({ id: 'mock', type: 'mock', deviceId: 'gpu', delayMs: 0 });
  const calibration: Calibration = {
    charsPerToken: (profile) => profile.charsPerToken,
    calibrate: () => Promise.resolve(),
  };
  const modelCalls = createModelCalls({
    config: configStore,
    queue,
    adapterFor: () => mock,
    campaigns: store,
    calibration,
    timeSource,
    logger,
  });
  // What the composition root gives the context module (CTX-110).
  const context: ContextDependencies = {
    profileFor: (role) => {
      const route = routeRole(config, role);
      if (!route.ok) return route;
      return ok({ profile: route.value.profile, charsPerToken: route.value.profile.charsPerToken });
    },
    contextSettings: () => config.context,
    profileTemplateDir: () => null,
  };
  const narrations = createNarrations({
    store,
    publish,
    streamText: options.wrapStreamText?.(modelCalls.streamText) ?? modelCalls.streamText,
    context,
    timeSource,
    newId,
    logger,
  });
  const deps: TurnDeps = { store, publish, timeSource, newId, logger, narrations };

  /** The latest `turn.status` published for a turn, or null. */
  const latestStatus = (turnId: string): StatusEvent | null =>
    events.findLast(
      (event): event is StatusEvent => event.type === 'turn.status' && event.turnId === turnId,
    ) ?? null;

  return {
    deps,
    mock,
    queue,
    events,
    timers,
    logger,
    /** Runs `listener` after each later event, in a microtask. */
    onEvent(listener: ((payload: ServerEventPayload) => void) | null) {
      onEvent = listener;
    },
    /** The events published for one turn, in order, job updates left out. */
    eventsOf: (turnId: string) =>
      events.filter((event) => 'turnId' in event && event.turnId === turnId),
    /** Resolves with the turn's status once its latest one is settled. */
    settled(turnId: string): Promise<TurnStatus> {
      return new Promise((resolve) => {
        const check = () => {
          const status = latestStatus(turnId)?.status;
          if (status === undefined || !SETTLED.includes(status)) return false;
          resolve(status);
          return true;
        };
        if (!check()) waiters.push(check);
      });
    },
    /** Creates the reference campaign; its opening narration starts at once. */
    async createArrival() {
      const created = await createCampaign(
        { store, content, timeSource, newId, logger, narrations },
        arrivalCommand(),
      );
      if (!created.ok) throw new Error(JSON.stringify(created.error));
      const { campaignId, currentBranchId: branchId, headTurnId: rootTurnId } = created.value;
      return { campaignId, branchId, rootTurnId };
    },
    /** Stops what is still running, so the space can close its databases. */
    async stop() {
      await narrations.stop();
      await queue.stop();
    },
  };
}

export type PlayStack = ReturnType<typeof playStack>;

/** The reference campaign on a play stack, its opening settled. */
export type OpenedCampaign = {
  campaignId: string;
  branchId: string;
  rootTurnId: string;
  openingStatus: TurnStatus;
  played: PlayStack;
  db: Database;
};

/**
 * Tracks the stacks a test file makes; `cleanUp` (awaited in `afterEach`) stops each
 * one's narrations and queue before the test space closes their databases (CONV-116).
 */
export function createPlaySpace() {
  const space = createTestSpace();
  const stacks: PlayStack[] = [];

  return {
    space,
    /** A new stack on a new data directory. */
    stack(options: PlayOptions = {}): PlayStack {
      const played = playStack(space, options);
      stacks.push(played);
      return played;
    },
    /**
     * The reference campaign, with the narrator's calls scripted in order (the opening
     * first; an empty script uses the mock's placeholders), once its opening settled.
     */
    async opened(script: MockOutcome[], options: PlayOptions = {}): Promise<OpenedCampaign> {
      const played = this.stack(options);
      if (script.length > 0) played.mock.script('narrator', ...script);
      const campaign = await played.createArrival();
      const openingStatus = await played.settled(campaign.rootTurnId);
      const opened = played.deps.store.openCampaign(campaign.campaignId);
      if (!opened.ok) throw new Error(opened.error.message);
      return { ...campaign, openingStatus, played, db: opened.value };
    },
    async cleanUp(): Promise<void> {
      for (const played of stacks.splice(0)) await played.stop();
      space.cleanUp();
    },
  };
}

/** Submits an in-character action at `expectedHeadTurnId` (the root by default). */
export function submit(campaign: OpenedCampaign, text: string, expectedHeadTurnId?: string) {
  return submitAction(campaign.played.deps, campaign.campaignId, {
    branchId: campaign.branchId,
    expectedHeadTurnId: expectedHeadTurnId ?? campaign.rootTurnId,
    mode: 'ic',
    text,
  });
}

/** Submits an action that must be accepted, and returns its turn's ID. */
export function submitted(
  campaign: OpenedCampaign,
  text: string,
  expectedHeadTurnId?: string,
): string {
  const result = submit(campaign, text, expectedHeadTurnId);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.turnId;
}
