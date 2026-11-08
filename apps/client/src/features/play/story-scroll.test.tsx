import type { TurnView } from '@mythos/contracts';
import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { campaignId } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';
import { answerStory, fakePage, sendEvent, turnAt, turnsFrom, turnsUrl } from './play-testing';

const writing = turnAt(1, { status: 'narrating', narration: { text: 'Varek ', complete: false } });

async function openPlay(story: TurnView[]) {
  answerStory(story);
  const app = renderApp(`/c/${campaignId}`);
  await screen.findAllByRole('link', { name: /^Inspect/ });
  return app;
}

function moreText(): Promise<void> {
  return sendEvent({ type: 'narration.delta', turnId: writing.turn.id, offset: 6, text: 'nods.' });
}

describe('story scrolling', () => {
  it('UI-053: the story opens at its end and follows new text for a reader at the bottom', async () => {
    const page = fakePage({ height: 2000, viewport: 800 });
    await openPlay([turnAt(0), writing]);
    expect(page.top).toBe(1200);
    page.setHeight(2100);
    await moreText();
    expect(page.top).toBe(1300);
    expect(screen.queryByRole('button', { name: 'New text below' })).toBeNull();
  });

  it('UI-053: a reader scrolled up stays put and gets "New text below", which goes to it', async () => {
    const page = fakePage({ height: 2000, viewport: 800 });
    const app = await openPlay([turnAt(0), writing]);
    act(() => {
      page.scrollTo(500);
    });
    page.setHeight(2100);
    await moreText();
    expect(page.top).toBe(500);
    await app.user.click(screen.getByRole('button', { name: 'New text below' }));
    expect(page.top).toBe(1300);
    expect(screen.queryByRole('button', { name: 'New text below' })).toBeNull();
  });

  it('UI-043: when the viewport shrinks for the keyboard, a reader at the bottom stays at the bottom', async () => {
    const page = fakePage({ height: 2000, viewport: 800 });
    await openPlay([turnAt(0), writing]);
    act(() => {
      page.resize(500);
    });
    expect(page.top).toBe(1500);
  });

  it('UI-043: when the viewport shrinks, a reader scrolled up keeps their place', async () => {
    const page = fakePage({ height: 2000, viewport: 800 });
    await openPlay([turnAt(0), writing]);
    act(() => {
      page.scrollTo(300);
      page.resize(500);
    });
    expect(page.top).toBe(300);
  });

  it("UI-043: when the dock's text box gains a line, a reader at the bottom stays at the bottom", async () => {
    const resized: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const page = fakePage({ height: 2000, viewport: 800 });
    await openPlay([turnAt(0), writing]);
    page.setHeight(2030);
    act(() => {
      for (const callback of resized) callback();
    });
    expect(page.top).toBe(1230);
  });

  it('UI-043: the input dock sticks to the bottom of the screen in the flow, never fixed over the story', async () => {
    await openPlay([turnAt(0)]);
    const dock = document.querySelector('[data-dock]');
    const classes = dock?.className.split(' ') ?? [];
    expect(classes).toEqual(expect.arrayContaining(['sticky', 'bottom-0']));
    expect(classes).not.toContain('fixed');
    expect(dock?.contains(screen.getByRole('textbox', { name: 'In character' }))).toBe(true);
  });

  it('UI-100: reaching the top asks for the newest 100, and the reader keeps their place', async () => {
    const page = fakePage({ height: 5000, viewport: 800 });
    answer('GET', turnsUrl('?limit=100'), { status: 200, body: turnsFrom(0, 99) });
    await openPlay(turnsFrom(50, 99));
    expect(screen.getByRole('button', { name: 'Show earlier turns' })).toBeDefined();
    act(() => {
      page.scrollTo(100);
    });
    page.setHeight(10_000);
    await screen.findByText('The fog thickens, 0.');
    expect(fetchCalls().map((call) => call.url)).toContain(turnsUrl('?limit=100'));
    expect(page.top).toBe(5100);
    expect(screen.queryByRole('button', { name: 'Show earlier turns' })).toBeNull();
  });

  it('UI-100: Show earlier turns asks for 50 more from the keyboard', async () => {
    answer('GET', turnsUrl('?limit=100'), { status: 200, body: turnsFrom(0, 99) });
    const app = await openPlay(turnsFrom(50, 99));
    screen.getByRole('button', { name: 'Show earlier turns' }).focus();
    await app.user.keyboard('{Enter}');
    expect(await screen.findByText('The fog thickens, 0.')).toBeDefined();
  });
});
