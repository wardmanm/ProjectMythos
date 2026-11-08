import type { TurnView } from '@mythos/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { branchId, campaignId } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { answerStory, sendEvent, turnAt, turnUrl } from './play-testing';

async function openPlay(story: TurnView[]) {
  answerStory(story);
  const app = renderApp(`/c/${campaignId}`);
  await screen.findAllByRole('link', { name: /^Inspect/ });
  return app;
}

function turnElement(view: TurnView): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-turn-id="${view.turn.id}"]`);
  if (element === null) throw new Error(`turn ${String(view.turn.depth)} is not on screen`);
  return element;
}

function classesOf(element: Element | null): string[] {
  return element?.className.split(' ') ?? [];
}

const failedTurn = turnAt(2, { status: 'stage-failed', narration: null });

describe('TurnBlock', () => {
  it("UI-050: in-character input is in the narration face, the player's color, and indented", async () => {
    await openPlay([turnAt(0), turnAt(1)]);
    const input = turnElement(turnAt(1)).querySelector('[data-input="ic"]');
    expect(input?.textContent).toBe('I look around, 1.');
    expect(classesOf(input)).toEqual(
      expect.arrayContaining(['font-narration', 'text-player-text', 'pl-8']),
    );
  });

  it('UI-050: out-of-character input is in the interface face, muted, and marked as such', async () => {
    const ooc = turnAt(1, { input: { mode: 'ooc', text: 'Can we skip to morning?' } });
    await openPlay([turnAt(0), ooc]);
    const input = turnElement(ooc).querySelector('[data-input="ooc"]');
    expect(classesOf(input)).toEqual(expect.arrayContaining(['font-interface', 'text-text-muted']));
    expect(within(input as HTMLElement).getByText('Out of character')).toBeDefined();
    expect(within(input as HTMLElement).getByText('Can we skip to morning?')).toBeDefined();
  });

  it("UI-051: narration is in the narration face at the theme's size and line height, a paragraph per block", async () => {
    const text = 'The fog has followed you in.\n\nVarek sets down his pen.\nHe waits.';
    const opening = turnAt(0, { narration: { text, complete: true } });
    await openPlay([opening]);
    const narration = turnElement(opening).querySelector('[data-narration]');
    expect(classesOf(narration)).toEqual(
      expect.arrayContaining([
        'font-narration',
        'text-(length:--narration-size)',
        'leading-(--narration-line-height)',
      ]),
    );
    const paragraphs = [...(narration?.querySelectorAll('p') ?? [])];
    expect(paragraphs.map((paragraph) => paragraph.textContent)).toEqual([
      'The fog has followed you in.',
      'Varek sets down his pen.\nHe waits.',
    ]);
    expect(classesOf(paragraphs[1] ?? null)).toContain('whitespace-pre-line');
  });

  it('UI-059: a failed turn says so in words and in the negative color, and Retry posts regenerate', async () => {
    const retryUrl = turnUrl(failedTurn.turn.id, '/regenerate');
    answer('POST', retryUrl, { status: 200, body: { turnId: failedTurn.turn.id } });
    const app = await openPlay([turnAt(0), turnAt(1), failedTurn]);
    const card = turnElement(failedTurn).querySelector('[data-failure]');
    expect(card?.textContent).toContain("The narration for this turn couldn't be written.");
    expect(card?.textContent).toContain("Retry, or check the narrator's model in Settings.");
    expect(classesOf(card)).toContain('border-l-negative');
    expect(card?.querySelector('svg.text-negative')).not.toBeNull();

    await app.user.click(screen.getByRole('button', { name: 'Retry' }));
    const retries = fetchCalls().filter((call) => call.url === retryUrl);
    expect(retries.map((call) => call.body)).toEqual([
      {
        branchId,
        expectedHeadTurnId: failedTurn.turn.id,
        turnId: failedTurn.turn.id,
        stage: 'narration',
      },
    ]);
    await sendEvent({ type: 'turn.status', turnId: failedTurn.turn.id, status: 'narrating' });
    expect(turnElement(failedTurn).querySelector('[data-failure]')).toBeNull();
    expect(within(turnElement(failedTurn)).getByText('Writing…')).toBeDefined();
  });

  it('UI-059, TRN-058: Cancel turn abandons a failed turn and puts its input back in the dock', async () => {
    const cancelUrl = turnUrl(failedTurn.turn.id, '/cancel');
    answer('POST', cancelUrl, {
      status: 200,
      body: turnAt(2, { status: 'abandoned', narration: null }),
    });
    const app = await openPlay([turnAt(0), turnAt(1), failedTurn]);
    const textbox = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'In character' });
    expect(textbox.readOnly).toBe(true);

    await app.user.click(screen.getByRole('button', { name: 'Cancel turn' }));
    expect(fetchCalls().find((call) => call.url === cancelUrl)?.body).toEqual({
      turnId: failedTurn.turn.id,
    });
    await sendEvent({ type: 'turn.status', turnId: failedTurn.turn.id, status: 'abandoned' });
    expect(textbox.value).toBe('I look around, 2.');
    expect(textbox.readOnly).toBe(false);
    expect(document.querySelector(`[data-turn-id="${failedTurn.turn.id}"]`)).toBeNull();
  });

  it('UI-059: a failed opening offers Retry but not Cancel turn, since there is nothing before it', async () => {
    const opening = turnAt(0, { status: 'stage-failed', narration: null });
    await openPlay([opening]);
    const card = turnElement(opening).querySelector('[data-failure]');
    expect(card?.textContent).toContain("The opening couldn't be written.");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Cancel turn' })).toBeNull();
  });

  it('UI-090: each turn has an Inspect link to its model calls', async () => {
    const app = await openPlay([turnAt(0), turnAt(1)]);
    await app.user.click(screen.getByRole('link', { name: 'Inspect turn 1' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Inspector' })).toBeDefined();
    expect(app.router.state.location.pathname).toBe(
      `/c/${campaignId}/inspector/${turnAt(1).turn.id}`,
    );
  });
});
