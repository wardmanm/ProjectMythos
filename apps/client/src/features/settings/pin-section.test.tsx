import { SECRET_PLACEHOLDER } from '@mythos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { machineConfig } from '@/test/settings-fixtures';
import { describedText, lastBody, region, renderSettings } from './settings-testing';

const pinSet = { hash: SECRET_PLACEHOLDER, localhostExempt: true };

function pinRegion() {
  return within(region('PIN'));
}

describe('PinSection', () => {
  it('PRV-004: setting the PIN applies at once, with no restart', async () => {
    const app = await renderSettings();
    expect(pinRegion().getByText('No PIN: anyone on your network can use Mythos.')).toBeDefined();
    expect(pinRegion().getByText(/Applies at once, with no restart/)).toBeDefined();

    await app.user.click(pinRegion().getByRole('button', { name: 'Set a PIN' }));
    await app.user.type(pinRegion().getByLabelText('New PIN'), '2468');
    await app.user.type(pinRegion().getByLabelText('The new PIN again'), '2468');
    answer('PUT', '/api/settings/pin', { status: 204 });
    answer('GET', '/api/settings', {
      status: 200,
      body: machineConfig({ server: { pin: pinSet } }),
    });
    await app.user.click(pinRegion().getByRole('button', { name: 'Save the PIN' }));

    expect(await pinRegion().findByText(/A PIN is set/)).toBeDefined();
    expect(lastBody('PUT', '/api/settings/pin')).toEqual({ pin: '2468', localhostExempt: true });
    expect(fetchCalls().some((call) => call.method === 'PUT' && call.url === '/api/settings')).toBe(
      false,
    );
    expect(screen.queryByText(/Restart Mythos/)).toBeNull();
  });

  it('ARCH-111: the localhost exemption goes with the PIN', async () => {
    const app = await renderSettings(machineConfig({ server: { pin: pinSet } }));
    expect(pinRegion().getByText(/This computer can use Mythos without it/)).toBeDefined();
    await app.user.click(pinRegion().getByRole('button', { name: 'Change the PIN' }));
    await app.user.type(pinRegion().getByLabelText('New PIN'), '1357');
    await app.user.type(pinRegion().getByLabelText('The new PIN again'), '1357');
    await app.user.click(
      pinRegion().getByRole('switch', { name: 'This computer can use Mythos without the PIN' }),
    );
    answer('PUT', '/api/settings/pin', { status: 204 });
    await app.user.click(pinRegion().getByRole('button', { name: 'Save the PIN' }));

    await waitFor(() => {
      expect(lastBody('PUT', '/api/settings/pin')).toEqual({ pin: '1357', localhostExempt: false });
    });
  });

  it("CON-091: the server's issue with the PIN shows at the PIN field", async () => {
    const app = await renderSettings();
    await app.user.click(pinRegion().getByRole('button', { name: 'Set a PIN' }));
    await app.user.type(pinRegion().getByLabelText('New PIN'), '12');
    await app.user.type(pinRegion().getByLabelText('The new PIN again'), '12');
    answer('PUT', '/api/settings/pin', {
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'x',
          details: { issues: [{ path: 'pin', message: 'Use 4 to 12 digits.' }] },
        },
      },
    });
    await app.user.click(pinRegion().getByRole('button', { name: 'Save the PIN' }));

    const pin = pinRegion().getByLabelText('New PIN');
    await waitFor(() => {
      expect(pin.getAttribute('aria-invalid')).toBe('true');
    });
    expect(describedText(pin)).toContain('Use 4 to 12 digits.');
  });

  it("ARCH-110: two PINs that don't match are never sent", async () => {
    const app = await renderSettings();
    await app.user.click(pinRegion().getByRole('button', { name: 'Set a PIN' }));
    await app.user.type(pinRegion().getByLabelText('New PIN'), '2468');
    await app.user.type(pinRegion().getByLabelText('The new PIN again'), '2469');
    await app.user.click(pinRegion().getByRole('button', { name: 'Save the PIN' }));

    expect(describedText(pinRegion().getByLabelText('The new PIN again'))).toContain(
      "The two PINs don't match.",
    );
    expect(lastBody('PUT', '/api/settings/pin')).toBeUndefined();
  });

  it('ARCH-110: removing the PIN asks first, then removes it', async () => {
    const app = await renderSettings(machineConfig({ server: { pin: pinSet } }));
    await app.user.click(pinRegion().getByRole('button', { name: 'Remove the PIN' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Anyone on your network will be able to use Mythos.');
    expect(lastBody('PUT', '/api/settings/pin')).toBeUndefined();

    answer('PUT', '/api/settings/pin', { status: 204 });
    await app.user.click(within(dialog).getByRole('button', { name: 'Remove the PIN' }));
    await waitFor(() => {
      expect(lastBody('PUT', '/api/settings/pin')).toEqual({ pin: null, localhostExempt: true });
    });
  });

  it('ARCH-110: the PIN waits while other changes are unsaved', async () => {
    const app = await renderSettings();
    await app.user.type(within(region('Server')).getByRole('textbox', { name: 'Port' }), '1');
    expect(pinRegion().getByRole('button', { name: 'Set a PIN' })).toHaveProperty('disabled', true);
    expect(pinRegion().getByText(/Save or discard your other changes first/)).toBeDefined();
  });
});
