import type { ServerEventPayload } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import type { MockOutcome } from '../providers';
import { type Database, readCanon, readTurn, readTurnSets } from '../storage';
import { NARRATION_MAX_CHARS, REFUSED } from './narration-outcome';
import {
  answer,
  createPlaySpace,
  failure,
  type OpenedCampaign,
  type PlayOptions,
  submitted,
} from './play-testing';
import { turnView } from './turn-view';

const play = createPlaySpace();
afterEach(async () => {
  await play.cleanUp();
});

const OPENING = 'Rain follows you down from the coach step.';
const REPLY = '"A room I have," she says, wiping her hands on her apron.';
const INPUT = 'I ask the innkeeper for a room.';

const openedCampaign = (script: MockOutcome[], options: PlayOptions = {}) =>
  play.opened(script, options);

/** Submits the first action and waits for its narration to settle. */
async function firstTurn(campaign: OpenedCampaign, text = INPUT) {
  const turnId = submitted(campaign, text);
  const status = await campaign.played.settled(turnId);
  return { turnId, status, events: campaign.played.eventsOf(turnId) };
}

type Delta = Extract<ServerEventPayload, { type: 'narration.delta' }>;
const deltasOf = (events: readonly ServerEventPayload[]) =>
  events.filter((event): event is Delta => event.type === 'narration.delta');

/** Each active set of a turn: its stage, origin, what it is based on, and its payloads. */
function setsOf(db: Database, turnId: string) {
  return readTurnSets(db, turnId).map(({ set, commits }) => ({
    id: set.id,
    stage: set.stage,
    origin: set.origin,
    basedOnSetIds: set.basedOnSetIds,
    payloads: commits.map(({ payload }) => payload),
  }));
}

describe('a full turn', () => {
  it('PRV-045: publishes turn.created, turn.status, its deltas in order at their offsets, and narration.done, and commits two sets', async () => {
    const campaign = await openedCampaign([answer(OPENING), answer(REPLY)]);
    const { turnId, status, events } = await firstTurn(campaign);

    expect(status).toBe('complete');
    const deltas = deltasOf(events);
    expect(deltas.length).toBeGreaterThan(1);
    let offset = 0;
    for (const delta of deltas) {
      expect(delta.offset).toBe(offset);
      offset += delta.text.length;
    }
    expect(deltas.map((delta) => delta.text).join('')).toBe(REPLY);
    expect(events).toEqual([
      { type: 'turn.created', branchId: campaign.branchId, turnId },
      { type: 'turn.status', turnId, status: 'narrating' },
      ...deltas,
      { type: 'narration.done', turnId },
      { type: 'turn.status', turnId, status: 'complete' },
    ]);

    const [input, narration] = setsOf(campaign.db, turnId);
    expect(setsOf(campaign.db, turnId)).toHaveLength(2);
    expect(input).toMatchObject({
      stage: 'input',
      origin: 'player',
      payloads: [{ type: 'input.set', mode: 'ic', text: INPUT }],
    });
    expect(narration).toMatchObject({
      stage: 'narration',
      origin: 'model',
      basedOnSetIds: [input?.id],
      payloads: [{ type: 'narration.set', text: REPLY, complete: true }],
    });
  });

  it('PRV-045: a profile that does not stream sends the whole narration as one delta', async () => {
    const campaign = await openedCampaign([answer(OPENING), answer(REPLY)], {
      profile: { streaming: false },
    });
    const { turnId, events } = await firstTurn(campaign);
    expect(deltasOf(events)).toEqual([{ type: 'narration.delta', turnId, offset: 0, text: REPLY }]);
  });

  it('TRN-050: the narrator gets the turn at its narration read point: the transcript so far, then this input', async () => {
    const campaign = await openedCampaign([answer(OPENING), answer(REPLY)]);
    await firstTurn(campaign);
    const request = campaign.played.mock.requests.at(-1);
    const prompt = request?.messages.map((message) => message.content).join('\n') ?? '';
    expect(request?.role).toBe('narrator');
    expect(prompt).toContain(OPENING);
    expect(prompt).toContain(INPUT);
    expect(prompt).not.toContain(REPLY);
  });

  it('CON-100: a turn’s events carry IDs and a status only; its text comes as deltas and from the turn view', async () => {
    const campaign = await openedCampaign([answer(OPENING), answer(REPLY)]);
    const { turnId, events } = await firstTurn(campaign);
    for (const event of events.filter((each) => each.type !== 'narration.delta')) {
      expect(
        Object.keys(event).every((key) => ['type', 'turnId', 'branchId', 'status'].includes(key)),
      ).toBe(true);
    }
    expect(events.some((event) => event.type === 'state.changed')).toBe(false);
    const view = turnView(campaign.played.deps, campaign.campaignId, turnId);
    expect(view.ok && view.value.narration).toEqual({ text: REPLY, complete: true });
  });
});

describe('turn zero', () => {
  it('TRN-057: campaign creation narrates the opening, committed on the root turn based on its setup set', async () => {
    const campaign = await openedCampaign([answer(OPENING)]);
    expect(campaign.openingStatus).toBe('complete');
    const [setup, narration] = setsOf(campaign.db, campaign.rootTurnId);
    expect(setup?.stage).toBe('setup');
    expect(narration).toMatchObject({
      stage: 'narration',
      origin: 'model',
      basedOnSetIds: [setup?.id],
      payloads: [{ type: 'narration.set', text: OPENING, complete: true }],
    });
    expect(readTurn(campaign.db, campaign.rootTurnId)?.status).toBe('complete');
  });

  it('CTX-076: the opening narration’s prompt holds the scenario’s opening file in place of an input', async () => {
    const campaign = await openedCampaign([answer(OPENING)]);
    const record = campaign.played.deps.store.readCampaign(campaign.db);
    const opening = readCanon(campaign.db, 'scenario', record.scenarioId)?.markdown ?? '';
    const firstLine = opening.split('\n').find((line) => line.trim().length > 20) ?? '';
    expect(firstLine.length).toBeGreaterThan(20);
    const [request] = campaign.played.mock.requests;
    const prompt = request?.messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).toContain(firstLine.trim());
  });

  it('TRN-052: with no narrator assigned, the opening fails before any text and says why', async () => {
    const campaign = await openedCampaign([], { narratorAssigned: false });
    expect(campaign.openingStatus).toBe('stage-failed');
    const events = campaign.played.eventsOf(campaign.rootTurnId);
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'not_configured' } });
    expect(setsOf(campaign.db, campaign.rootTurnId).map((set) => set.stage)).toEqual(['setup']);
  });
});

describe('narration that ends early', () => {
  it('TRN-051: a length stop commits the text with complete false, and the turn completes', async () => {
    const campaign = await openedCampaign([
      answer(OPENING),
      answer('She opens her mouth to', { finishReason: 'length' }),
    ]);
    const { turnId, status } = await firstTurn(campaign);
    expect(status).toBe('complete');
    expect(setsOf(campaign.db, turnId)[1]?.payloads).toEqual([
      { type: 'narration.set', text: 'She opens her mouth to', complete: false },
    ]);
  });

  it('TRN-051: narration past 20,000 characters is cut there, its deltas stop there, and it is committed incomplete', async () => {
    const long = 'rain '.repeat(4100);
    const campaign = await openedCampaign([answer(OPENING), answer(long)]);
    const { turnId, status, events } = await firstTurn(campaign);
    expect(status).toBe('complete');
    const sent = deltasOf(events)
      .map((delta) => delta.text)
      .join('');
    expect(sent).toBe(long.slice(0, NARRATION_MAX_CHARS));
    expect(setsOf(campaign.db, turnId)[1]?.payloads).toEqual([
      { type: 'narration.set', text: sent, complete: false },
    ]);
  });

  it('TRN-052: a provider error after some text commits that text incomplete, completes the turn, and shows the error', async () => {
    const campaign = await openedCampaign([
      answer(OPENING),
      failure('provider_rejected', 'She frowns and '),
    ]);
    const { turnId, status, events } = await firstTurn(campaign);
    expect(status).toBe('complete');
    expect(setsOf(campaign.db, turnId)[1]?.payloads).toEqual([
      { type: 'narration.set', text: 'She frowns and ', complete: false },
    ]);
    expect(events.slice(-3)).toMatchObject([
      { type: 'narration.done', turnId },
      { type: 'turn.status', turnId, status: 'complete' },
      { type: 'error', turnId, error: { code: 'provider_rejected' } },
    ]);
  });

  it('TRN-052: a provider error before any text leaves the turn stage-failed, with nothing committed', async () => {
    const campaign = await openedCampaign([answer(OPENING), failure('provider_rejected')]);
    const { turnId, status, events } = await firstTurn(campaign);
    expect(status).toBe('stage-failed');
    expect(setsOf(campaign.db, turnId).map((set) => set.stage)).toEqual(['input']);
    expect(events.slice(-2)).toMatchObject([
      { type: 'turn.status', turnId, status: 'stage-failed' },
      { type: 'error', turnId, error: { code: 'provider_rejected' } },
    ]);
    expect(campaign.played.logger.entries).toContainEqual(
      expect.objectContaining({ level: 'warn', message: 'narration failed' }),
    );
  });

  it('TRN-052: a refusal with no text fails the stage with an error that leaves the model’s words out', async () => {
    const campaign = await openedCampaign([
      answer(OPENING),
      answer('', { finishReason: 'refusal' }),
    ]);
    const { status, events } = await firstTurn(campaign);
    expect(status).toBe('stage-failed');
    expect(events.at(-1)).toMatchObject({ type: 'error', error: REFUSED });
  });

  it('TRN-052: an unexpected throw leaves the turn stage-failed with internal_error, and is logged', async () => {
    let calls = 0;
    const campaign = await openedCampaign([answer(OPENING)], {
      wrapStreamText: (real) => (options) => {
        calls += 1;
        return calls === 1 ? real(options) : Promise.reject(new Error('the disk caught fire'));
      },
    });
    const { status, events } = await firstTurn(campaign);
    expect(status).toBe('stage-failed');
    expect(events.at(-1)).toMatchObject({ type: 'error', error: { code: 'internal_error' } });
    expect(campaign.played.logger.entries).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'narration failed unexpectedly' }),
    );
  });
});
