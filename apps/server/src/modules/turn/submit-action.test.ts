import type { Turn } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { readBranch, readTurn, readTurnSets, readTurnsOnBranch } from '../storage';
import { answer, createPlaySpace, failure, submit, submitted } from './play-testing';
import { readyForAction, submitAction } from './submit-action';

const play = createPlaySpace();
afterEach(async () => {
  await play.cleanUp();
});

const OPENING = 'Rain follows you down from the coach step.';

describe('submitAction', () => {
  it('TRN-011, TRN-030: the turn, its input set, and the new head are stored before the call returns', async () => {
    const campaign = await play.opened([answer(OPENING), answer('She nods.')]);
    const turnId = submitted(campaign, 'I nod back.');

    // Nothing has been awaited: the narration has not run yet, but the input is safe.
    const turn = readTurn(campaign.db, turnId);
    expect(turn).toMatchObject({
      parentTurnId: campaign.rootTurnId,
      depth: 1,
      status: 'narrating',
    });
    expect(readBranch(campaign.db, campaign.branchId)?.headTurnId).toBe(turnId);
    expect(readTurnsOnBranch(campaign.db, campaign.branchId, null, 10).map((t) => t.id)).toEqual([
      campaign.rootTurnId,
      turnId,
    ]);
    const sets = readTurnSets(campaign.db, turnId);
    expect(sets.map(({ set }) => [set.stage, set.origin])).toEqual([['input', 'player']]);
    expect(sets[0]?.commits.map(({ payload }) => payload)).toEqual([
      { type: 'input.set', mode: 'ic', text: 'I nod back.' },
    ]);
    await campaign.played.settled(turnId);
  });

  it('TRN-011: a new turn starts at the game time of the head it follows', async () => {
    const campaign = await play.opened([answer(OPENING), answer('She nods.')]);
    const turnId = submitted(campaign, 'I nod back.');
    const root = readTurn(campaign.db, campaign.rootTurnId);
    expect(readTurn(campaign.db, turnId)?.gameTimeStart).toBe(root?.gameTimeStart);
    expect(root?.gameTimeStart).toBeGreaterThan(0);
    await campaign.played.settled(turnId);
  });

  it('TRN-120: a stale expectedHeadTurnId is a conflict, and nothing is stored', async () => {
    const campaign = await play.opened([answer(OPENING), answer('She nods.')]);
    const first = submitted(campaign, 'I nod back.');
    await campaign.played.settled(first);

    const stale = submit(campaign, 'I nod again.', campaign.rootTurnId);
    expect(stale).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(readTurnsOnBranch(campaign.db, campaign.branchId, null, 10)).toHaveLength(2);
  });

  it('TRN-058: a second action while the head is narrating gets turn_in_progress', async () => {
    const campaign = await play.opened([answer(OPENING), answer('She nods slowly.')]);
    const first = submitted(campaign, 'I nod back.');

    const second = submit(campaign, 'I wave.', first);
    expect(second).toMatchObject({ ok: false, error: { code: 'turn_in_progress' } });
    expect(second.ok || second.error.message).toBe('The GM is still narrating the last turn.');
    await campaign.played.settled(first);
    expect(readTurnsOnBranch(campaign.db, campaign.branchId, null, 10)).toHaveLength(2);
  });

  it('TRN-058: a stage-failed head must be retried or cancelled before the next action', async () => {
    const campaign = await play.opened([answer(OPENING), failure('provider_rejected')]);
    const failed = submitted(campaign, 'I nod back.');
    expect(await campaign.played.settled(failed)).toBe('stage-failed');

    const next = submit(campaign, 'I try again.', failed);
    expect(next).toMatchObject({
      ok: false,
      error: {
        code: 'turn_in_progress',
        message: 'The last turn failed: retry it or cancel it first.',
      },
    });
  });

  it('TRN-058: an extraction-failed or world-tick-failed head takes a new action; any other waits', () => {
    const idle = { inFlight: () => false };
    const head = (status: Turn['status']): Turn => ({
      id: '00000000-0000-4000-8000-000000000001',
      parentTurnId: null,
      depth: 0,
      status,
      gameTimeStart: 0,
      copiedFromTurnId: null,
      createdAt: '2026-11-05T12:00:00.000Z',
    });
    for (const status of ['complete', 'extraction-failed', 'world-tick-failed'] as const) {
      expect(readyForAction(idle, 'campaign', head(status)).ok).toBe(true);
    }
    for (const status of [
      'adjudicating',
      'awaiting-resolution',
      'extracting',
      'world-ticking',
    ] as const) {
      expect(readyForAction(idle, 'campaign', head(status))).toMatchObject({
        ok: false,
        error: { code: 'turn_in_progress' },
      });
    }
  });

  it('ARCH-070: while any narration of the campaign runs, a new action waits, whatever its head', () => {
    const busy = { inFlight: (campaignId: string) => campaignId === 'busy' };
    const head: Turn = {
      id: '00000000-0000-4000-8000-000000000001',
      parentTurnId: null,
      depth: 0,
      status: 'complete',
      gameTimeStart: 0,
      copiedFromTurnId: null,
      createdAt: '2026-11-05T12:00:00.000Z',
    };
    expect(readyForAction(busy, 'busy', head)).toMatchObject({
      ok: false,
      error: { code: 'turn_in_progress' },
    });
    expect(readyForAction(busy, 'other', head).ok).toBe(true);
  });

  it('TRN-011: out-of-character input waits for phase 3, and an unknown campaign or branch is not_found', async () => {
    const campaign = await play.opened([answer(OPENING)]);
    const command = {
      branchId: campaign.branchId,
      expectedHeadTurnId: campaign.rootTurnId,
      mode: 'ooc' as const,
      text: 'Can I see the map?',
    };
    expect(submitAction(campaign.played.deps, campaign.campaignId, command)).toEqual({
      ok: false,
      error: {
        code: 'validation_failed',
        message: 'Out-of-character input arrives with adjudication in phase 3.',
        details: {
          issues: [
            {
              path: 'mode',
              message: 'Out-of-character input arrives with adjudication in phase 3.',
            },
          ],
        },
      },
    });
    const ic = { ...command, mode: 'ic' as const };
    const unknown = '00000000-0000-4000-8000-00000000ffff';
    expect(submitAction(campaign.played.deps, unknown, ic)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(
      submitAction(campaign.played.deps, campaign.campaignId, { ...ic, branchId: unknown }),
    ).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect(readTurnsOnBranch(campaign.db, campaign.branchId, null, 10)).toHaveLength(1);
  });
});
