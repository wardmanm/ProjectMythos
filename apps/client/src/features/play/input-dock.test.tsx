import type { TurnView } from '@mythos/contracts';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { setDeviceWidth } from '@/test/fake-match-media';
import { branchId, campaignId } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { answerStory, sendEvent, turnAt, turnIdAt, turnsUrl, turnUrl } from './play-testing';

const actionsUrl = `/api/campaigns/${campaignId}/actions`;

async function openPlay(story: TurnView[]) {
  answerStory(story);
  const app = renderApp(`/c/${campaignId}`);
  await screen.findAllByRole('link', { name: /^Inspect/ });
  const textbox = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'In character' });
  return { app, textbox };
}

/** The line that says why the dock can't send, as the text box's description. */
function reasonOf(textbox: HTMLTextAreaElement): string | null {
  const id = textbox.getAttribute('aria-describedby');
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

function posts(url: string) {
  return fetchCalls().filter((call) => call.method === 'POST' && call.url === url);
}

describe('InputDock', () => {
  it('UI-073: an unavailable dock says why, is read-only, and keeps its draft', async () => {
    localStorage.setItem(`mythos.draft.${campaignId}`, 'I wait for him to finish.');
    const writing = turnAt(1, {
      status: 'narrating',
      narration: { text: 'Varek ', complete: false },
    });
    const { app, textbox } = await openPlay([turnAt(0), writing]);
    expect(textbox.value).toBe('I wait for him to finish.');
    expect(textbox.readOnly).toBe(true);
    expect(reasonOf(textbox)).toBe('The GM is writing…');
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await app.user.type(textbox, ' Then I go.');
    expect(textbox.value).toBe('I wait for him to finish.');
  });

  it('UI-074: on desktop, Shift+Enter adds a line and Enter sends the branch, its head, and the text', async () => {
    answer('POST', actionsUrl, { status: 200, body: { turnId: turnIdAt(2) } });
    const { app, textbox } = await openPlay([turnAt(0), turnAt(1)]);
    expect(reasonOf(textbox)).toBeNull();
    await app.user.type(textbox, 'I ask Varek');
    await app.user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(textbox.value).toBe('I ask Varek\n');
    expect(posts(actionsUrl)).toHaveLength(0);
    await app.user.type(textbox, 'about the ship.');
    await app.user.keyboard('{Enter}');
    expect(posts(actionsUrl).map((call) => call.body)).toEqual([
      {
        branchId,
        expectedHeadTurnId: turnIdAt(1),
        mode: 'ic',
        text: 'I ask Varek\nabout the ship.',
      },
    ]);
  });

  it('UI-073, UI-074: once sent, the draft is cleared and the dock waits for the new turn', async () => {
    answer('POST', actionsUrl, { status: 200, body: { turnId: turnIdAt(2) } });
    const { app, textbox } = await openPlay([turnAt(0), turnAt(1)]);
    await app.user.type(textbox, 'I ask Varek about the ship.{Enter}');
    await screen.findByText('Sending…');
    expect(textbox.value).toBe('');
    expect(localStorage.getItem(`mythos.draft.${campaignId}`)).toBeNull();

    const sent = turnAt(2, { status: 'narrating', narration: null });
    answer('GET', turnsUrl('?limit=50'), { status: 200, body: [turnAt(0), turnAt(1), sent] });
    await sendEvent({ type: 'turn.created', branchId, turnId: sent.turn.id });
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeDefined();
    expect(reasonOf(textbox)).toBe('The GM is writing…');
  });

  it('UI-074: on a phone, Enter adds a line and the Send button sends', async () => {
    setDeviceWidth(390);
    answer('POST', actionsUrl, { status: 200, body: { turnId: turnIdAt(2) } });
    const { app, textbox } = await openPlay([turnAt(0)]);
    await app.user.type(textbox, 'I listen.{Enter}');
    expect(textbox.value).toBe('I listen.\n');
    expect(posts(actionsUrl)).toHaveLength(0);
    await app.user.click(screen.getByRole('button', { name: 'Send' }));
    expect(posts(actionsUrl).map((call) => call.body)).toEqual([
      { branchId, expectedHeadTurnId: turnIdAt(0), mode: 'ic', text: 'I listen.' },
    ]);
  });

  it('UI-074: Enter never sends while an input method is composing', async () => {
    const { app, textbox } = await openPlay([turnAt(0)]);
    await app.user.type(textbox, 'こんにちは');
    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true });
    fireEvent.compositionStart(textbox);
    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(posts(actionsUrl)).toHaveLength(0);
  });

  it('UI-135: while narration streams, Stop replaces Send and cancels it, keeping what was written', async () => {
    const text = 'Varek sets down his pen.';
    const writing = turnAt(1, { status: 'narrating', narration: { text, complete: false } });
    const stopped = turnAt(1, { narration: { text, complete: false } });
    const cancelUrl = turnUrl(writing.turn.id, '/cancel');
    answer('POST', cancelUrl, { status: 200, body: stopped });
    const { app, textbox } = await openPlay([turnAt(0), writing]);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    await app.user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(posts(cancelUrl).map((call) => call.body)).toEqual([{ turnId: writing.turn.id }]);

    await sendEvent({ type: 'turn.status', turnId: writing.turn.id, status: 'complete' });
    const narration = document.querySelector(
      `[data-turn-id="${writing.turn.id}"] [data-narration]`,
    );
    expect(narration?.textContent).toBe(text);
    expect(screen.getByText('The narration stopped before the end.')).toBeDefined();
    expect(textbox.value).toBe('');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
  });

  it('UI-135: Stop before any text abandons the turn and puts its input back in the dock', async () => {
    const writing = turnAt(1, { status: 'narrating', narration: null });
    const cancelUrl = turnUrl(writing.turn.id, '/cancel');
    answer('POST', cancelUrl, {
      status: 200,
      body: turnAt(1, { status: 'abandoned', narration: null }),
    });
    const { app, textbox } = await openPlay([turnAt(0), writing]);
    await app.user.click(screen.getByRole('button', { name: 'Stop' }));
    await sendEvent({ type: 'turn.status', turnId: writing.turn.id, status: 'abandoned' });
    expect(textbox.value).toBe('I look around, 1.');
    expect(document.querySelector(`[data-turn-id="${writing.turn.id}"]`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDefined();
  });
});
