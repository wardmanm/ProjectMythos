import type { AppError, Job, Result, ServerEventPayload, TurnView } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { readBranch, readTurnSets, readTurnsOnBranch } from '../storage';
import { cancelTurn } from './cancel-turn';
import { answer, createPlaySpace, failure, submitted } from './play-testing';

const play = createPlaySpace();
afterEach(async () => {
  await play.cleanUp();
});

const OPENING = 'Rain follows you down from the coach step.';
const LONG =
  'The innkeeper leans on the bar and tells you, at length and with relish, every rumour ' +
  'the harbour has heard since the squall: the lost boat, the clerk, the lamps on the point.';

type ViewResult = Result<TurnView, AppError>;

const deltaText = (events: readonly ServerEventPayload[]) =>
  events.flatMap((event) => (event.type === 'narration.delta' ? [event.text] : [])).join('');

describe('Stop while narration streams', () => {
  it('TRN-149, PRV-047: Stop mid-stream commits the text so far with complete false, and the turn completes', async () => {
    const campaign = await play.opened([answer(OPENING), answer(LONG)]);
    const stop: { view: Promise<ViewResult> | null } = { view: null };
    campaign.played.onEvent((event) => {
      if (event.type === 'narration.delta' && event.turnId !== campaign.rootTurnId) {
        stop.view ??= cancelTurn(campaign.played.deps, campaign.campaignId, {
          turnId: event.turnId,
        });
      }
    });
    const turnId = submitted(campaign, 'I listen.');
    expect(await campaign.played.settled(turnId)).toBe('complete');

    const sent = deltaText(campaign.played.eventsOf(turnId));
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(LONG.length);
    const view = await stop.view;
    expect(view).toMatchObject({ ok: true, value: { narration: { text: sent, complete: false } } });
    const narration = readTurnSets(campaign.db, turnId).find(
      ({ set }) => set.stage === 'narration',
    );
    expect(narration?.commits.map(({ payload }) => payload)).toEqual([
      { type: 'narration.set', text: sent, complete: false },
    ]);
  });

  it('TRN-010: a stopped turn is complete; that its narration was cut short is the narration’s, not the status’s', async () => {
    const campaign = await play.opened([answer(OPENING), answer(LONG)]);
    const stop: { view: Promise<ViewResult> | null } = { view: null };
    campaign.played.onEvent((event) => {
      if (event.type === 'narration.delta' && event.turnId !== campaign.rootTurnId) {
        stop.view ??= cancelTurn(campaign.played.deps, campaign.campaignId, {
          turnId: event.turnId,
        });
      }
    });
    const turnId = submitted(campaign, 'I listen.');
    await campaign.played.settled(turnId);
    const view = await stop.view;
    expect(view?.ok && [view.value.turn.status, view.value.narration?.complete]).toEqual([
      'complete',
      false,
    ]);
  });

  it('PRV-061: Stop aborts the signal given to streamText, which cancels the narration’s interactive job', async () => {
    const campaign = await play.opened([answer(OPENING), answer(LONG)]);
    const stop: { view: Promise<ViewResult> | null } = { view: null };
    campaign.played.onEvent((event) => {
      if (event.type === 'narration.delta' && event.turnId !== campaign.rootTurnId) {
        stop.view ??= cancelTurn(campaign.played.deps, campaign.campaignId, {
          turnId: event.turnId,
        });
      }
    });
    const turnId = submitted(campaign, 'I listen.');
    await campaign.played.settled(turnId);
    await stop.view;
    const jobs = campaign.played.events.flatMap((event): Job[] =>
      event.type === 'job.updated' && event.job.turnId === turnId ? [event.job] : [],
    );
    expect(jobs.at(0)?.type).toBe('interactive');
    expect(jobs.at(-1)?.status).toBe('cancelled');
  });

  it('TRN-149, TRN-047: Stop before any text abandons the turn, moves the head back, and returns the input', async () => {
    const campaign = await play.opened([answer(OPENING), answer(LONG)]);
    const turnId = submitted(campaign, 'I listen at the door.');
    const view = await cancelTurn(campaign.played.deps, campaign.campaignId, { turnId });

    expect(view).toMatchObject({
      ok: true,
      value: {
        turn: { id: turnId, status: 'abandoned' },
        input: { mode: 'ic', text: 'I listen at the door.' },
        narration: null,
      },
    });
    expect(readBranch(campaign.db, campaign.branchId)?.headTurnId).toBe(campaign.rootTurnId);
    expect(readTurnsOnBranch(campaign.db, campaign.branchId, null, 10)).toHaveLength(1);
    expect(campaign.played.eventsOf(turnId).at(-1)).toEqual({
      type: 'turn.status',
      turnId,
      status: 'abandoned',
    });
    // No narrator call was made after the opening, and play goes on from the parent.
    expect(campaign.played.mock.requests).toHaveLength(1);
    const next = submitted(campaign, 'I knock instead.');
    expect(await campaign.played.settled(next)).toBe('complete');
  });

  it('TRN-149: Stop on the opening before any text leaves the root turn stage-failed, with no error shown', async () => {
    const stop: { view: Promise<ViewResult> | null } = { view: null };
    const played = play.stack({
      wrapStreamText: (real) => (options) => {
        // The player presses Stop just as the narrator is called.
        stop.view = cancelTurn(played.deps, options.campaignId, { turnId: options.turnId ?? '' });
        return real(options);
      },
    });
    const { rootTurnId } = await played.createArrival();
    expect(await played.settled(rootTurnId)).toBe('stage-failed');
    expect(await stop.view).toMatchObject({
      ok: true,
      value: { turn: { status: 'stage-failed' } },
    });
    expect(played.eventsOf(rootTurnId).some((event) => event.type === 'error')).toBe(false);
  });
});

describe('cancel when nothing is streaming', () => {
  it('TRN-047: cancelling a stage-failed turn abandons it, so play can go on', async () => {
    const campaign = await play.opened([
      answer(OPENING),
      failure('provider_rejected'),
      answer('Fine.'),
    ]);
    const turnId = submitted(campaign, 'I listen.');
    expect(await campaign.played.settled(turnId)).toBe('stage-failed');

    const view = await cancelTurn(campaign.played.deps, campaign.campaignId, { turnId });
    expect(view).toMatchObject({
      ok: true,
      value: { turn: { status: 'abandoned' }, input: { text: 'I listen.' } },
    });
    expect(readBranch(campaign.db, campaign.branchId)?.headTurnId).toBe(campaign.rootTurnId);
    const next = submitted(campaign, 'I knock instead.');
    expect(await campaign.played.settled(next)).toBe('complete');
  });

  it('TRN-149: cancelling a finished turn or a failed opening changes nothing; an unknown turn is not_found', async () => {
    const campaign = await play.opened([answer(OPENING), answer('She nods.')]);
    const turnId = submitted(campaign, 'I nod.');
    await campaign.played.settled(turnId);
    const view = await cancelTurn(campaign.played.deps, campaign.campaignId, { turnId });
    expect(view).toMatchObject({
      ok: true,
      value: { turn: { status: 'complete' }, narration: { text: 'She nods.', complete: true } },
    });

    const failed = await play.opened([], { narratorAssigned: false });
    expect(failed.openingStatus).toBe('stage-failed');
    const root = await cancelTurn(failed.played.deps, failed.campaignId, {
      turnId: failed.rootTurnId,
    });
    expect(root).toMatchObject({ ok: true, value: { turn: { status: 'stage-failed' } } });

    const unknown = '00000000-0000-4000-8000-00000000ffff';
    expect(
      await cancelTurn(campaign.played.deps, campaign.campaignId, { turnId: unknown }),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
  });
});
