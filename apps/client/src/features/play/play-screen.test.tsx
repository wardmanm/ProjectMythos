import type { TurnView } from '@mythos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer } from '@/test/fake-fetch';
import { setDevicePrefersReducedMotion } from '@/test/fake-match-media';
import { campaignId } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { answerStory, sendEvent, turnAt, turnIdAt, turnsUrl, turnUrl } from './play-testing';

const openingId = turnIdAt(0);

/** The opening, still being written, with `text` so far (TRN-150). */
function openingSoFar(text: string): TurnView {
  return turnAt(0, { status: 'narrating', narration: { text, complete: false } });
}

/** What the screen shows of a turn's narration. */
function narrationOf(turnId: string): string {
  const element = document.querySelector(`[data-turn-id="${turnId}"] [data-narration]`);
  return element?.textContent ?? '';
}

function delta(turnId: string, offset: number, text: string): Promise<void> {
  return sendEvent({ type: 'narration.delta', turnId, offset, text });
}

/** The server finishes a turn: its lists and the turn itself now answer with `view`. */
function finish(view: TurnView, story: TurnView[]): Promise<void> {
  answer('GET', turnsUrl('?limit=50'), { status: 200, body: story });
  answer('GET', turnUrl(view.turn.id), { status: 200, body: view });
  return sendEvent({ type: 'narration.done', turnId: view.turn.id });
}

async function openPlay(story: TurnView[]) {
  answerStory(story);
  const app = renderApp(`/c/${campaignId}`);
  await screen.findByRole('heading', { level: 1, name: 'Brinemoor: Arrival' });
  await screen.findAllByRole('link', { name: /^Inspect/ });
  return app;
}

describe('PlayScreen', () => {
  it('UI-053: streamed narration appears in order, after what the opening already had', async () => {
    await openPlay([openingSoFar('The fog ')]);
    expect(narrationOf(openingId)).toBe('The fog ');
    await delta(openingId, 8, 'has followed you in.');
    expect(narrationOf(openingId)).toBe('The fog has followed you in.');
    await delta(openingId, 28, ' Varek looks up.');
    expect(narrationOf(openingId)).toBe('The fog has followed you in. Varek looks up.');
  });

  it('UI-054: a turn being narrated says "Writing…" under its text, which stays readable', async () => {
    await openPlay([openingSoFar('The fog has followed you in. ')]);
    const opening = document.querySelector(`[data-turn-id="${openingId}"]`);
    expect(opening).not.toBeNull();
    const status = within(opening as HTMLElement).getByText('Writing…');
    expect(status.className).toContain('text-text-muted');
    expect(narrationOf(openingId)).toBe('The fog has followed you in. ');
    await finish(turnAt(0), [turnAt(0)]);
    await screen.findByText('The fog thickens, 0.');
    expect(screen.queryByText('Writing…')).toBeNull();
  });

  it('UI-053: with reduced motion, streamed text appears a whole sentence at a time', async () => {
    setDevicePrefersReducedMotion(true);
    await openPlay([openingSoFar('The fog has followed you in. Var')]);
    expect(narrationOf(openingId)).toBe('The fog has followed you in.');
    await delta(openingId, 32, 'ek looks up. He');
    expect(narrationOf(openingId)).toBe('The fog has followed you in. Varek looks up.');
    const done = turnAt(0, {
      narration: { text: 'The fog has followed you in. Varek looks up. He nods', complete: true },
    });
    await finish(done, [done]);
    await waitFor(() => {
      expect(narrationOf(openingId)).toBe(done.narration?.text);
    });
  });

  it('UI-112: new narration is announced politely, a sentence at a time, and history is not', async () => {
    const writing = turnAt(1, { status: 'narrating', narration: null });
    await openPlay([turnAt(0), writing]);
    const region = screen.getByRole('status', { name: 'New narration' });
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    await delta(writing.turn.id, 0, 'Varek sets down his pen. He');
    expect(region.textContent).toBe('Varek sets down his pen.');
    const text = 'Varek sets down his pen. He looks up.';
    const done = turnAt(1, { narration: { text, complete: true } });
    await finish(done, [turnAt(0), done]);
    await within(region).findByText('He looks up.');
    expect(region.textContent).not.toContain('The fog thickens');
  });

  it('UI-112: the story itself has no live region, so nothing already on screen is read out', async () => {
    await openPlay([turnAt(0), turnAt(1)]);
    const story = document.querySelector('[data-story]');
    expect(story).not.toBeNull();
    expect(story?.closest('[aria-live]')).toBeNull();
    expect(story?.querySelector('[aria-live]')).toBeNull();
  });

  it('UI-040: the story and the input dock sit in the same measure-wide column', async () => {
    await openPlay([turnAt(0)]);
    const columnOf = (element: Element | null) =>
      element?.closest('.max-w-\\(--narration-measure\\)')?.className.split(' ') ?? [];
    const story = columnOf(document.querySelector('[data-story]'));
    const dock = columnOf(screen.getByRole('textbox', { name: 'In character' }));
    for (const classes of [story, dock]) {
      expect(classes).toContain('mx-auto');
      expect(classes).toContain('text-left');
      expect(classes).not.toContain('text-justify');
    }
  });

  it('UI-040: on a campaign screen the header shows the campaign name and the date in game, and stays at the top', async () => {
    await openPlay([turnAt(0)]);
    const header = screen.getByRole('banner');
    expect(within(header).getByRole('link', { name: 'Brinemoor: Arrival' })).toBeDefined();
    expect(await within(header).findByText('Monday, October 12, 1874, evening')).toBeDefined();
    expect(header.className.split(' ')).toEqual(expect.arrayContaining(['sticky', 'top-0']));
    expect(within(header).queryByRole('link', { name: 'Mythos' })).toBeNull();
  });
});
