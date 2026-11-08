import { SECRET_PLACEHOLDER } from '@mythos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer } from '@/test/fake-fetch';
import { renderApp } from '@/test/render-app';
import { machineConfig } from '@/test/settings-fixtures';
import { defaultMachineConfig } from './default-config';
import {
  answerSave,
  card,
  describedText,
  lastBody,
  region,
  renderSettings,
} from './settings-testing';

const pinSet = { hash: SECRET_PLACEHOLDER, localhostExempt: true };

describe('SettingsScreen', () => {
  it('UI-088: the screen shows every section of the machine config from GET /settings', async () => {
    await renderSettings();
    for (const name of [
      'Providers',
      'Model profiles',
      'Roles',
      'Devices',
      'Server',
      'Advanced',
      'PIN',
    ]) {
      expect(region(name), name).toBeDefined();
    }
    expect(card('Provider ollama-local')).toBeDefined();
    expect(card('Model profile qwen-local')).toBeDefined();
    expect(card('Device macbook-gpu')).toBeDefined();
    expect(
      within(region('Roles')).getByRole('combobox', { name: 'Narrator' }).textContent,
    ).toContain('qwen-local');
  });

  it('UI-088, PRV-004: the address, port, and data folder each say they need a restart', async () => {
    await renderSettings();
    const server = region('Server');
    for (const name of ['Network address', 'Port', 'Data folder']) {
      const field = within(server).getByRole('textbox', { name });
      expect(describedText(field), name).toContain('Needs a restart.');
    }
    expect(describedText(within(server).getByRole('textbox', { name: 'Port' }))).toContain(
      'Default: 5317',
    );
  });

  it('PRV-003: Save sends the whole config with PUT /settings and says it saved', async () => {
    const app = await renderSettings();
    const port = within(region('Server')).getByRole('textbox', { name: 'Port' });
    await app.user.clear(port);
    await app.user.type(port, '6000');
    expect(screen.getByText('Unsaved changes')).toBeDefined();

    const saved = machineConfig({ server: { port: 6000 } });
    answerSave(saved);
    await app.user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved.')).toBeDefined();
    expect(lastBody('PUT', '/api/settings')).toEqual(saved);
  });

  it('PRV-003: Discard puts every field back as saved', async () => {
    const app = await renderSettings();
    const port = within(region('Server')).getByRole('textbox', { name: 'Port' });
    await app.user.clear(port);
    await app.user.type(port, '6000');
    await app.user.click(screen.getByRole('button', { name: 'Discard' }));

    expect(port).toHaveProperty('value', '5317');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('PRV-004: a restart notice appears when the port changes', async () => {
    const app = await renderSettings();
    const port = within(region('Server')).getByRole('textbox', { name: 'Port' });
    await app.user.clear(port);
    await app.user.type(port, '6000');
    answerSave(machineConfig({ server: { port: 6000 } }), true);
    await app.user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText(
        'Saved. Restart Mythos to use the new network address, port, or data folder.',
      ),
    ).toBeDefined();
  });

  it('PRV-004: a save that needs no restart shows no restart notice', async () => {
    const app = await renderSettings();
    const name = within(card('Device macbook-gpu')).getByRole('textbox', { name: 'Name' });
    await app.user.type(name, ' 2');
    answerSave(machineConfig({ devices: [{ id: 'macbook-gpu', name: 'MacBook Pro GPU 2' }] }));
    await app.user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    expect(screen.queryByText(/Restart Mythos/)).toBeNull();
  });

  it('CON-091: a save with two issues shows both at their fields', async () => {
    const app = await renderSettings();
    answer('PUT', '/api/settings', {
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'machine-config.json has problems.',
          details: {
            issues: [
              { path: 'providers.0.baseUrl', message: 'Invalid URL' },
              { path: 'modelProfiles.0.contextWindow', message: 'Too small: expected >0' },
            ],
          },
        },
      },
    });
    const port = within(region('Server')).getByRole('textbox', { name: 'Port' });
    await app.user.type(port, '1');
    await app.user.click(screen.getByRole('button', { name: 'Save' }));

    const address = within(card('Provider ollama-local')).getByRole('textbox', {
      name: 'Server address',
    });
    await waitFor(() => {
      expect(address.getAttribute('aria-invalid')).toBe('true');
    });
    expect(describedText(address)).toContain('Invalid URL');
    const window = within(card('Model profile qwen-local')).getByRole('textbox', {
      name: 'Context window, in tokens',
    });
    expect(window.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(window)).toContain('Too small: expected >0');
    expect(screen.getByText('Not saved: 2 problems to fix.')).toBeDefined();
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  it('CON-091: an issue no field shows is listed with where it is', async () => {
    const app = await renderSettings();
    answer('PUT', '/api/settings', {
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'x',
          details: { issues: [{ path: 'mediaProfiles.0.id', message: 'Duplicate id' }] },
        },
      },
    });
    await app.user.type(within(region('Server')).getByRole('textbox', { name: 'Port' }), '1');
    await app.user.click(screen.getByRole('button', { name: 'Save' }));

    const summary = await screen.findByText('Not saved: 1 problem to fix.');
    expect(summary.closest('[role="alert"]')?.textContent).toContain(
      'mediaProfiles.0.id: Duplicate id',
    );
  });

  it('CON-111: a save takes the PIN from the latest GET, so a PIN removed meanwhile stays removed', async () => {
    const app = await renderSettings(machineConfig({ server: { pin: pinSet } }));
    expect(within(region('PIN')).getByText(/A PIN is set/)).toBeDefined();
    answer('GET', '/api/settings', { status: 200, body: machineConfig() });
    await app.queryClient.invalidateQueries();
    await within(region('PIN')).findByText(/No PIN/);

    await app.user.type(within(region('Server')).getByRole('textbox', { name: 'Port' }), '1');
    answerSave(machineConfig({ server: { port: 53171 } }));
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    const body = lastBody('PUT', '/api/settings');
    expect(body).toMatchObject({ server: { pin: null, port: 53171 } });
  });

  it('CON-111: the PIN hash goes back as the placeholder, untouched', async () => {
    const app = await renderSettings(machineConfig({ server: { pin: pinSet } }));
    await app.user.type(within(region('Server')).getByRole('textbox', { name: 'Port' }), '1');
    answerSave(machineConfig({ server: { pin: pinSet, port: 53171 } }));
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    expect(lastBody('PUT', '/api/settings')).toMatchObject({ server: { pin: pinSet } });
  });

  it('PRV-001: a broken config lists its issues and can start again from the default settings', async () => {
    answer('GET', '/api/settings', {
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'machine-config.json has problems.',
          details: {
            issues: [
              { path: '', message: 'machine-config.json is not valid JSON: Unexpected token' },
              { path: 'providers.0.deviceId', message: '"gpu" is not the id of a device' },
            ],
          },
        },
      },
    });
    const app = renderApp('/settings');
    const alert = await screen.findByRole('heading', { name: 'The settings file has problems' });
    const text = alert.closest('[role="alert"]')?.textContent ?? '';
    expect(text).toContain('machine-config.json');
    expect(text).toContain('The whole file: machine-config.json is not valid JSON');
    expect(text).toContain('providers.0.deviceId: "gpu" is not the id of a device');

    await app.user.click(screen.getByRole('button', { name: 'Start from default settings' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('stored API keys included');
    answer('GET', '/api/settings', { status: 200, body: defaultMachineConfig() });
    answerSave(defaultMachineConfig(), true);
    await app.user.click(within(dialog).getByRole('button', { name: 'Replace it' }));

    expect(await screen.findByRole('region', { name: 'Providers' })).toBeDefined();
    expect(lastBody('PUT', '/api/settings')).toEqual(defaultMachineConfig());
    expect(card('Device this-computer')).toBeDefined();
    expect(screen.getByText(/Restart Mythos/)).toBeDefined();
  });

  it('PRV-001: the default settings are the ones the first start writes', () => {
    const config = defaultMachineConfig();
    expect(config.devices).toEqual([
      { id: 'this-computer', name: 'This computer', concurrency: 1 },
    ]);
    expect(config.providers).toEqual([
      {
        id: 'ollama-local',
        type: 'ollama',
        baseUrl: 'http://localhost:11434',
        deviceId: 'this-computer',
        keepAlive: '30m',
      },
    ]);
    expect(config.modelProfiles).toEqual([]);
    expect(Object.values(config.roles).every((role) => role === null)).toBe(true);
  });

  it('UI-120: no heading, label, or button on the settings screen is in capitals', async () => {
    await renderSettings();
    const labelled = document.body.querySelectorAll(
      'h1, h2, h3, h4, button, label, legend, summary',
    );
    expect(labelled.length).toBeGreaterThan(50);
    for (const element of labelled) {
      const words = element.textContent.replace(/\bPIN\b/g, '').trim();
      const hasLetters = /[A-Za-z]{2}/.test(words);
      expect(hasLetters && words === words.toUpperCase(), `"${words}"`).toBe(false);
    }
  });
});
