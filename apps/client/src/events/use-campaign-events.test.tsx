import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { answer } from '@/test/fake-fetch';
import { FakeEventSource, latestEventSource } from '@/test/fake-event-source';
import { branchId, campaignId, campaignView, serverEvent, turnId } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';

const campaignUrl = `/api/campaigns/${campaignId}`;

describe('useCampaignEvents', () => {
  it('ARCH-120: an event reaches the screen only through the query cache', async () => {
    answer('GET', campaignUrl, { status: 200, body: campaignView() });
    renderApp(`/c/${campaignId}`);
    await screen.findByRole('heading', { name: 'Brinemoor: Arrival' });

    // The event carries no campaign data: the heading changes because the cache refetched.
    answer('GET', campaignUrl, { status: 200, body: campaignView({ name: 'Brinemoor: Fog' }) });
    act(() => {
      latestEventSource().open();
      latestEventSource().send(serverEvent({ type: 'turn.created', branchId, turnId }));
    });
    expect(await screen.findByRole('heading', { name: 'Brinemoor: Fog' })).toBeDefined();
  });

  it("UI-101: the campaign's one stream stays open across its screens and closes when the player leaves", async () => {
    answer('GET', campaignUrl, { status: 200, body: campaignView() });
    const app = renderApp(`/c/${campaignId}`);
    await screen.findByRole('heading', { name: 'Brinemoor: Arrival' });
    const source = latestEventSource();

    await act(() => app.router.navigate(`/c/${campaignId}/inspector/${turnId}`));
    expect(FakeEventSource.instances).toEqual([source]);
    expect(source.readyState).not.toBe(FakeEventSource.CLOSED);

    await act(() => app.router.navigate('/'));
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('UI-132: a stream reopened after the browser gave up refetches the campaign', async () => {
    answer('GET', campaignUrl, { status: 200, body: campaignView() });
    renderApp(`/c/${campaignId}`);
    await screen.findByRole('heading', { name: 'Brinemoor: Arrival' });
    vi.useFakeTimers();
    answer('GET', campaignUrl, { status: 200, body: campaignView({ name: 'Brinemoor: Fog' }) });
    act(() => {
      latestEventSource().fail();
      vi.advanceTimersByTime(1000);
      latestEventSource().open();
    });
    vi.useRealTimers();
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(await screen.findByRole('heading', { name: 'Brinemoor: Fog' })).toBeDefined();
  });
});
