import type { TurnView } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { campaignView } from './campaign-view';
import { answer, createPlaySpace, submitted } from './play-testing';
import { branchViews, turnView, turnViews } from './turn-view';

const play = createPlaySpace();
afterEach(async () => {
  await play.cleanUp();
});

const OPENING = 'Rain follows you down from the coach step.';
const REPLY = 'She sets down the jug and looks you over, slowly, from boots to brim.';
const unknown = '00000000-0000-4000-8000-00000000ffff';

describe('turnView', () => {
  it('TRN-150: mid-stream, the turn holds the text streamed so far, marked incomplete', async () => {
    const campaign = await play.opened([answer(OPENING), answer(REPLY)]);
    const seen: { view: TurnView | null; sent: string } = { view: null, sent: '' };
    campaign.played.onEvent((event) => {
      if (event.type !== 'narration.delta' || event.turnId === campaign.rootTurnId) return;
      if (seen.view !== null) return;
      const view = turnView(campaign.played.deps, campaign.campaignId, event.turnId);
      if (!view.ok) throw new Error(view.error.message);
      seen.view = view.value;
      seen.sent = campaign.played
        .eventsOf(event.turnId)
        .flatMap((each) => (each.type === 'narration.delta' ? [each.text] : []))
        .join('');
    });
    const turnId = submitted(campaign, 'I take off my hat.');
    await campaign.played.settled(turnId);

    expect(seen.sent.length).toBeGreaterThan(0);
    expect(seen.sent.length).toBeLessThan(REPLY.length);
    expect(seen.view?.turn.status).toBe('narrating');
    expect(seen.view?.narration).toEqual({ text: seen.sent, complete: false });
    const after = turnView(campaign.played.deps, campaign.campaignId, turnId);
    expect(after.ok && after.value.narration).toEqual({ text: REPLY, complete: true });
  });

  it('TRN-150: a turn waiting for its first word shows empty, incomplete narration', async () => {
    const campaign = await play.opened([answer(OPENING), answer(REPLY)]);
    const turnId = submitted(campaign, 'I take off my hat.');
    const view = turnView(campaign.played.deps, campaign.campaignId, turnId);
    expect(view.ok && view.value.narration).toEqual({ text: '', complete: false });
    await campaign.played.settled(turnId);
  });

  it('TRN-057: the root turn’s view has its opening, no input, and the campaign’s date; every later part is empty', async () => {
    const campaign = await play.opened([answer(OPENING)]);
    const view = turnView(campaign.played.deps, campaign.campaignId, campaign.rootTurnId);
    const campaignLabel = campaignView(campaign.played.deps.store, campaign.campaignId);
    if (!view.ok || !campaignLabel.ok) throw new Error('expected both views');
    const { turn, ...parts } = view.value;
    expect(turn).toMatchObject({ id: campaign.rootTurnId, parentTurnId: null, status: 'complete' });
    expect(parts).toEqual({
      gameTimeLabel: campaignLabel.value.gameTimeLabel,
      input: null,
      ruling: null,
      visibleExplanation: null,
      draft: null,
      resolution: null,
      narration: { text: OPENING, complete: true },
      staleStages: [],
      failedStages: [],
      replayConflictCount: 0,
      offscreen: null,
      versionCounts: {},
      sharedWithOtherBranches: false,
      bookmarkNames: [],
    });
    expect(turnView(campaign.played.deps, campaign.campaignId, unknown)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});

describe('turnViews and branchViews', () => {
  it('TRN-011: a branch’s turns come oldest first, a page at a time back from the head', async () => {
    const campaign = await play.opened([answer(OPENING), answer('One.'), answer('Two.')]);
    const first = submitted(campaign, 'First.');
    await campaign.played.settled(first);
    const second = submitted(campaign, 'Second.', first);
    await campaign.played.settled(second);

    const page = (beforeDepth: number | null, limit: number) => {
      const views = turnViews(campaign.played.deps, campaign.campaignId, campaign.branchId, {
        beforeDepth,
        limit,
      });
      return views.ok
        ? views.value.map((view) => [view.input?.text ?? null, view.narration?.text])
        : views;
    };
    expect(page(null, 10)).toEqual([
      [null, OPENING],
      ['First.', 'One.'],
      ['Second.', 'Two.'],
    ]);
    expect(page(null, 2)).toEqual([
      ['First.', 'One.'],
      ['Second.', 'Two.'],
    ]);
    expect(page(1, 10)).toEqual([[null, OPENING]]);
    expect(
      turnViews(campaign.played.deps, campaign.campaignId, unknown, {
        beforeDepth: null,
        limit: 10,
      }),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });

    expect(branchViews(campaign.played.deps.store, campaign.campaignId)).toMatchObject({
      ok: true,
      value: [
        {
          branch: { id: campaign.branchId, name: 'Main', headTurnId: second, archived: false },
          headDepth: 2,
          isCurrent: true,
        },
      ],
    });
    expect(branchViews(campaign.played.deps.store, unknown)).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });
});
