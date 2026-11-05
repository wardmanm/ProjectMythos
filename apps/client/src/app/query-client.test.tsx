import { CampaignViewSchema, TurnViewSchema } from '@mythos/contracts';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { apiError } from '@/api/api-failure';
import { request } from '@/api/client';
import { queryKeys } from '@/api/query-keys';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { campaignId, campaignView, turnId, turnView } from '@/test/fixtures';
import { currentPath, renderApp } from '@/test/render-app';
import { shouldRetry } from './query-client';

const campaignUrl = `/api/campaigns/${campaignId}`;

describe('createQueryClient', () => {
  it('ARCH-110, ARCH-122: auth_required from any query goes to /pin with the address to return to', async () => {
    answer('GET', campaignUrl, {
      status: 401,
      body: { error: { code: 'auth_required', message: 'PIN required' } },
    });
    const app = renderApp(`/c/${campaignId}?from=library`);
    expect(await screen.findByRole('heading', { name: 'Enter the PIN' })).toBeDefined();
    expect(currentPath(app)).toBe(
      `/pin?next=${encodeURIComponent(`/c/${campaignId}?from=library`)}`,
    );
  });

  it('UI-102: a conflict refetches every query and says the campaign changed on another device', async () => {
    answer('GET', campaignUrl, { status: 200, body: campaignView() });
    const app = renderApp(`/c/${campaignId}`);
    await screen.findByRole('heading', { name: 'Brinemoor: Arrival' });
    const before = fetchCalls().length;

    answer('POST', `${campaignUrl}/actions`, {
      status: 409,
      body: { error: { code: 'conflict', message: 'head moved' } },
    });
    const command = app.queryClient.getMutationCache().build(app.queryClient, {
      mutationFn: () =>
        request(`/campaigns/${campaignId}/actions`, CampaignViewSchema, { method: 'POST' }),
    });
    await command.execute(undefined).catch(() => undefined);

    expect(
      await screen.findByText('This campaign changed on another device. Showing the latest.'),
    ).toBeDefined();
    await waitFor(() => {
      expect(
        fetchCalls()
          .slice(before)
          .map((call) => `${call.method} ${call.url}`),
      ).toContain(`GET ${campaignUrl}`);
    });
  });

  it("UI-102: a command's response leaves the cache alone", async () => {
    const app = renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    const key = queryKeys.turn(campaignId, turnId);
    app.queryClient.setQueryData(key, turnView('The fog '));

    answer('POST', `${campaignUrl}/turns/${turnId}/cancel`, {
      status: 200,
      body: turnView('The fog has followed you in.'),
    });
    const cancel = app.queryClient.getMutationCache().build(app.queryClient, {
      mutationFn: () =>
        request(`/campaigns/${campaignId}/turns/${turnId}/cancel`, TurnViewSchema, {
          method: 'POST',
        }),
    });
    const response = await cancel.execute(undefined);

    expect(response.narration?.text).toBe('The fog has followed you in.');

    expect(app.queryClient.getQueryData(key)).toEqual(turnView('The fog '));
    expect(app.queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it('ARCH-122: only an unreachable server is retried, and only twice', () => {
    const unreachable = apiError({ kind: 'unreachable', detail: 'offline' });
    const server = apiError({
      kind: 'server',
      status: 503,
      error: { code: 'provider_unavailable', message: 'down' },
    });
    expect([0, 1, 2].map((count) => shouldRetry(count, unreachable))).toEqual([true, true, false]);
    expect(shouldRetry(0, server)).toBe(false);
    expect(shouldRetry(0, new Error('a bug'))).toBe(false);
  });
});
