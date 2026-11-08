import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { campaignId, campaignView } from '@/test/fixtures';
import { currentPath, renderApp } from '@/test/render-app';
import { sessionState } from '@/test/settings-fixtures';

const campaignUrl = `/api/campaigns/${campaignId}`;
const pinPath = (next: string) => `/pin?next=${encodeURIComponent(next)}`;

function refuse(code: 'auth_failed' | 'rate_limited' | 'auth_required', details?: unknown): void {
  const status = code === 'rate_limited' ? 429 : 401;
  answer('POST', '/api/session', {
    status,
    body: { error: { code, message: 'x', ...(details === undefined ? {} : { details }) } },
  });
}

describe('PinScreen', () => {
  it('ARCH-110: the PIN screen logs in and returns to the screen the player came from', async () => {
    answer('GET', campaignUrl, {
      status: 401,
      body: { error: { code: 'auth_required', message: 'PIN required' } },
    });
    answer('GET', '/api/session', { status: 200, body: sessionState() });
    const app = renderApp(`/c/${campaignId}?from=library`);
    await screen.findByRole('heading', { name: 'Enter the PIN' });
    expect(currentPath(app)).toBe(pinPath(`/c/${campaignId}?from=library`));

    answer('POST', '/api/session', { status: 204 });
    answer('GET', campaignUrl, { status: 200, body: campaignView() });
    await app.user.type(screen.getByLabelText('PIN'), '2468');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect(await screen.findByRole('heading', { name: 'Brinemoor: Arrival' })).toBeDefined();
    expect(currentPath(app)).toBe(`/c/${campaignId}?from=library`);
    const login = fetchCalls().find(
      (call) => call.method === 'POST' && call.url === '/api/session',
    );
    expect(login?.body).toEqual({ pin: '2468' });
  });

  it('ARCH-110: a rate_limited answer says how long to wait', async () => {
    answer('GET', '/api/session', { status: 200, body: sessionState() });
    const app = renderApp(pinPath('/'));
    refuse('rate_limited', { retryAfterSeconds: 300 });
    await app.user.type(await screen.findByLabelText('PIN'), '0000');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many wrong PINs. Try again in 5 minutes.',
    );
  });

  it('ARCH-110: a short wait is in seconds, and a wait with no details still has words', async () => {
    answer('GET', '/api/session', { status: 200, body: sessionState() });
    const app = renderApp(pinPath('/'));
    refuse('rate_limited', { retryAfterSeconds: 42 });
    await app.user.type(await screen.findByLabelText('PIN'), '0000');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Too many wrong PINs. Try again in 42 seconds.',
    );

    refuse('rate_limited');
    await app.user.type(screen.getByLabelText('PIN'), '0000');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Too many tries in a row. Wait a minute, then try again.',
      );
    });
  });

  it('ARCH-110: a wrong PIN says so, and the field is cleared and focused for another try', async () => {
    answer('GET', '/api/session', { status: 200, body: sessionState() });
    const app = renderApp(pinPath('/settings'));
    refuse('auth_failed');
    const field = await screen.findByLabelText('PIN');
    await app.user.type(field, '1111');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      "That PIN isn't right. Check it and try again.",
    );
    expect(field).toHaveProperty('value', '');
    expect(document.activeElement).toBe(field);
    expect(currentPath(app)).toBe(pinPath('/settings'));
  });

  it('ARCH-110: auth_required at login says only the host can use Mythos until it is fixed', async () => {
    answer('GET', '/api/session', { status: 200, body: sessionState() });
    const app = renderApp(pinPath('/'));
    refuse('auth_required');
    await app.user.type(await screen.findByLabelText('PIN'), '1111');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'only the computer it runs on can use it',
    );
  });

  it('ARCH-110, ARCH-111: a device that needs no PIN, or has a session, goes straight on', async () => {
    answer('GET', '/api/session', { status: 200, body: sessionState({ pinRequired: false }) });
    answer('GET', '/api/settings', {
      status: 404,
      body: { error: { code: 'not_found', message: 'x' } },
    });
    const exempt = renderApp(pinPath('/settings'));
    await waitFor(() => {
      expect(currentPath(exempt)).toBe('/settings');
    });
    exempt.view.unmount();

    answer('GET', '/api/session', { status: 200, body: sessionState({ authenticated: true }) });
    const signedIn = renderApp(pinPath('/new'));
    await waitFor(() => {
      expect(currentPath(signedIn)).toBe('/new');
    });
  });

  it('ARCH-110: an address that would leave the app returns to the library instead', async () => {
    answer('GET', '/api/session', { status: 200, body: sessionState() });
    const app = renderApp(pinPath('//evil.example/steal'));
    answer('POST', '/api/session', { status: 204 });
    await app.user.type(await screen.findByLabelText('PIN'), '2468');
    await app.user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => {
      expect(currentPath(app)).toBe('/');
    });
  });
});
