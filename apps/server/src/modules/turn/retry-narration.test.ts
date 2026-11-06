import { afterEach, describe, expect, it } from 'vitest';
import { insertTurn, readTurn, readTurnSets } from '../storage';
import type { RegenerateStageCommand } from './deps';
import { answer, createPlaySpace, failure, type OpenedCampaign, submitted } from './play-testing';
import { recoverInterruptedTurns, regenerateStage } from './retry-narration';
import { TEST_NOW } from './testing';

const play = createPlaySpace();
afterEach(async () => {
  await play.cleanUp();
});

const OPENING = 'Rain follows you down from the coach step.';

/** A retry of `turnId`'s narration, at the head the test expects. */
function retry(
  campaign: OpenedCampaign,
  turnId: string,
  extra: Partial<RegenerateStageCommand> = {},
) {
  return regenerateStage(campaign.played.deps, campaign.campaignId, {
    branchId: campaign.branchId,
    expectedHeadTurnId: turnId,
    turnId,
    stage: 'narration',
    regenerateDownstream: true,
    ...extra,
  });
}

/** The text of a turn's committed narration, or null. */
function narrationOf(campaign: OpenedCampaign, turnId: string) {
  const set = readTurnSets(campaign.db, turnId).find(({ set: each }) => each.stage === 'narration');
  const payload = set?.commits[0]?.payload;
  return payload?.type === 'narration.set'
    ? { text: payload.text, basedOn: set?.set.basedOnSetIds }
    : null;
}

/**
 * A turn as a crash leaves it: stored with its input, `narrating`, with no narration
 * running in this process.
 */
function interruptedTurn(campaign: OpenedCampaign): { turnId: string; inputSetId: string } {
  const { newId } = campaign.played.deps;
  const turnId = newId();
  const inputSetId = newId();
  insertTurn(campaign.db, {
    branchId: campaign.branchId,
    turn: {
      id: turnId,
      parentTurnId: campaign.rootTurnId,
      depth: 1,
      status: 'narrating',
      gameTimeStart: readTurn(campaign.db, campaign.rootTurnId)?.gameTimeStart ?? 0,
      copiedFromTurnId: null,
      createdAt: TEST_NOW.toISOString(),
    },
    sets: [
      {
        set: {
          id: inputSetId,
          turnId,
          stage: 'input',
          origin: 'player',
          supersedesSetId: null,
          basedOnSetIds: [],
          copiedFromSetId: null,
          schemaVersion: 1,
          createdAt: TEST_NOW.toISOString(),
        },
        commits: [{ id: newId(), payload: { type: 'input.set', mode: 'ic', text: 'I wait.' } }],
      },
    ],
  });
  return { turnId, inputSetId };
}

describe('restart', () => {
  it('TRN-012: a turn a restart left narrating becomes stage-failed, and a retry completes it', async () => {
    const campaign = await play.opened([answer(OPENING), answer('The clock ticks on.')]);
    const { turnId, inputSetId } = interruptedTurn(campaign);

    expect(await recoverInterruptedTurns(campaign.played.deps)).toBe(1);
    expect(readTurn(campaign.db, turnId)?.status).toBe('stage-failed');
    expect(readTurn(campaign.db, campaign.rootTurnId)?.status).toBe('complete');

    expect(retry(campaign, turnId)).toEqual({ ok: true, value: { turnId } });
    expect(await campaign.played.settled(turnId)).toBe('complete');
    expect(narrationOf(campaign, turnId)).toEqual({
      text: 'The clock ticks on.',
      basedOn: [inputSetId],
    });
  });

  it('TRN-012: a campaign that will not open is logged and skipped', async () => {
    const campaign = await play.opened([answer(OPENING)]);
    interruptedTurn(campaign);
    const { store, logger } = campaign.played.deps;
    const missing = '00000000-0000-4000-8000-00000000ffff';
    const listing = {
      ...store,
      listCampaigns: () => Promise.resolve([missing, campaign.campaignId]),
    };
    expect(await recoverInterruptedTurns({ store: listing, logger })).toBe(1);
    const skipped = campaign.played.logger.entries.filter(
      (entry) => entry.level === 'error' && entry.fields.campaignId === missing,
    );
    expect(skipped.map((entry) => entry.message)).toEqual(['could not recover interrupted turns']);
  });
});

describe('retrying a failed narration', () => {
  it('TRN-052: a failed narration retried through regenerate streams again and completes', async () => {
    const campaign = await play.opened([
      answer(OPENING),
      failure('provider_rejected'),
      answer('The second try lands.'),
    ]);
    const turnId = submitted(campaign, 'I try the door.');
    expect(await campaign.played.settled(turnId)).toBe('stage-failed');

    expect(retry(campaign, turnId).ok).toBe(true);
    expect(campaign.played.eventsOf(turnId).at(-1)).toEqual({
      type: 'turn.status',
      turnId,
      status: 'narrating',
    });
    expect(await campaign.played.settled(turnId)).toBe('complete');
    expect(narrationOf(campaign, turnId)?.text).toBe('The second try lands.');
  });

  it('TRN-057: a failed opening is retried on the root turn, based on its setup set', async () => {
    const campaign = await play.opened([failure('provider_rejected'), answer(OPENING)]);
    expect(campaign.openingStatus).toBe('stage-failed');
    expect(retry(campaign, campaign.rootTurnId).ok).toBe(true);
    expect(await campaign.played.settled(campaign.rootTurnId)).toBe('complete');
    const setup = readTurnSets(campaign.db, campaign.rootTurnId)[0]?.set;
    expect(setup?.stage).toBe('setup');
    expect(narrationOf(campaign, campaign.rootTurnId)).toEqual({
      text: OPENING,
      basedOn: [setup?.id],
    });
  });

  it('TRN-120: a retry of a turn that is no longer the head expected is a conflict', async () => {
    const campaign = await play.opened([answer(OPENING), failure('provider_rejected')]);
    const turnId = submitted(campaign, 'I try the door.');
    await campaign.played.settled(turnId);
    expect(retry(campaign, turnId, { expectedHeadTurnId: campaign.rootTurnId })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });

  it('TRN-058: phase 1 retries only a failed head’s narration; anything else is refused at its field', async () => {
    const campaign = await play.opened([answer(OPENING), answer('She nods slowly.')]);
    const refusal = (extra: Partial<RegenerateStageCommand>, turnId = campaign.rootTurnId) => {
      const result = retry(campaign, turnId, extra);
      return result.ok ? null : [result.error.code, result.error.message];
    };
    expect(refusal({ stage: 'adjudication' })).toEqual([
      'validation_failed',
      'Regenerating adjudication arrives in phase 3.',
    ]);
    expect(refusal({ stage: 'extraction' })).toEqual([
      'validation_failed',
      'Regenerating extraction arrives in phase 4.',
    ]);
    expect(refusal({ instruction: 'Make it rain harder.' })?.[0]).toBe('validation_failed');
    expect(refusal({ profileId: 'other-model' })?.[0]).toBe('validation_failed');
    // A finished head's narration is regenerated in phase 2.
    expect(refusal({})).toEqual([
      'validation_failed',
      'Regenerating narration that finished arrives in phase 2.',
    ]);

    const turnId = submitted(campaign, 'I wave.');
    // While it narrates, a retry waits.
    expect(refusal({}, turnId)?.[0]).toBe('turn_in_progress');
    await campaign.played.settled(turnId);
    // An earlier turn, named under the current head.
    expect(refusal({ expectedHeadTurnId: turnId, turnId: campaign.rootTurnId }, turnId)).toEqual([
      'validation_failed',
      'Regenerating an earlier turn arrives in phase 2.',
    ]);
  });
});
