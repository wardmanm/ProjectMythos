import { SECRET_PLACEHOLDER, type MachineConfig } from '@mythos/contracts';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { machineConfig, providerStatuses } from '@/test/settings-fixtures';
import {
  answerSave,
  card,
  choose,
  describedText,
  lastBody,
  region,
  renderSettings,
} from './settings-testing';

const ollama = {
  id: 'ollama-local',
  type: 'ollama',
  baseUrl: 'http://localhost:11434',
  deviceId: 'macbook-gpu',
} as const;

function withAnthropic(apiKey: { value: string } | { env: string }): MachineConfig {
  return machineConfig({
    devices: [
      { id: 'macbook-gpu', name: 'MacBook Pro GPU' },
      { id: 'cloud', name: 'Cloud APIs' },
    ],
    providers: [ollama, { id: 'anthropic', type: 'anthropic', deviceId: 'cloud', apiKey }],
  });
}

const statuses = providerStatuses([
  {
    providerId: 'ollama-local',
    health: { reachable: true, latencyMs: 12, detail: 'Ollama 0.40.14 is running' },
  },
  {
    providerId: 'anthropic',
    health: { reachable: false, latencyMs: null, detail: 'Anthropic refused the key. Check it.' },
  },
]);

function inputValues(): string[] {
  return [...document.querySelectorAll('input')].map((input) => input.value);
}

describe('ProvidersSection', () => {
  it('PRV-005: a stored key shows only as set, never its value, with Replace', async () => {
    await renderSettings(withAnthropic({ value: SECRET_PLACEHOLDER }), statuses);
    const anthropic = within(card('Provider anthropic'));
    expect(anthropic.getByText('A key is set.')).toBeDefined();
    expect(anthropic.getByRole('button', { name: 'Replace the key' })).toBeDefined();
    expect(inputValues()).not.toContain(SECRET_PLACEHOLDER);
  });

  it('PRV-005: a key from the environment shows the variable name', async () => {
    await renderSettings(withAnthropic({ env: 'ANTHROPIC_API_KEY' }), statuses);
    const variable = within(card('Provider anthropic')).getByRole('textbox', {
      name: 'Environment variable',
    });
    expect(variable).toHaveProperty('value', 'ANTHROPIC_API_KEY');
    expect(describedText(variable)).toContain('Safer than storing the key');
  });

  it('PRV-005: a replaced key is sent once, then shows as set like any other', async () => {
    const app = await renderSettings(withAnthropic({ value: SECRET_PLACEHOLDER }), statuses);
    const anthropic = within(card('Provider anthropic'));
    await app.user.click(anthropic.getByRole('button', { name: 'Replace the key' }));
    await app.user.type(anthropic.getByLabelText('API key'), 'sk-ant-new');
    answerSave(withAnthropic({ value: SECRET_PLACEHOLDER }));
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    expect(lastBody('PUT', '/api/settings')).toMatchObject({
      providers: [ollama, { id: 'anthropic', apiKey: { value: 'sk-ant-new' } }],
    });
    expect(within(card('Provider anthropic')).getByText('A key is set.')).toBeDefined();
    expect(inputValues()).not.toContain('sk-ant-new');
  });

  it('CON-111: a save sends a stored key back as the placeholder, untouched', async () => {
    const app = await renderSettings(withAnthropic({ value: SECRET_PLACEHOLDER }), statuses);
    const name = within(card('Device cloud')).getByRole('textbox', { name: 'Name' });
    await app.user.type(name, ' here');
    answerSave(withAnthropic({ value: SECRET_PLACEHOLDER }));
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    expect(lastBody('PUT', '/api/settings')).toMatchObject({
      providers: [ollama, { id: 'anthropic', apiKey: { value: SECRET_PLACEHOLDER } }],
    });
  });

  it('CON-111: Replace can be taken back, which keeps the saved key', async () => {
    const app = await renderSettings(withAnthropic({ value: SECRET_PLACEHOLDER }), statuses);
    const anthropic = within(card('Provider anthropic'));
    await app.user.click(anthropic.getByRole('button', { name: 'Replace the key' }));
    await app.user.click(anthropic.getByRole('button', { name: 'Keep the saved key' }));
    expect(anthropic.getByText('A key is set.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('PRV-091: each provider has a health dot, in words, with its detail', async () => {
    await renderSettings(withAnthropic({ env: 'ANTHROPIC_API_KEY' }), statuses);
    const local = within(card('Provider ollama-local'));
    expect(await local.findByText('Reachable, 12 ms')).toBeDefined();
    expect(local.getByText('Ollama 0.40.14 is running')).toBeDefined();
    const cloud = within(card('Provider anthropic'));
    expect(cloud.getByText('Not reachable')).toBeDefined();
    expect(cloud.getByText('Anthropic refused the key. Check it.')).toBeDefined();
  });

  it('PRV-091: a new or changed provider says to save before it is checked', async () => {
    const app = await renderSettings();
    await within(card('Provider ollama-local')).findByText('Reachable, 12 ms');
    await app.user.click(screen.getByRole('button', { name: 'Add a provider' }));
    expect(within(card('Provider provider')).getByText('Save to check')).toBeDefined();

    const address = within(card('Provider ollama-local')).getByRole('textbox', {
      name: 'Server address',
    });
    await app.user.type(address, '/');
    expect(within(card('Provider ollama-local')).getByText('Save to check')).toBeDefined();
  });

  it("PRV-003: a new provider's id and type can be chosen; a saved one's are fixed", async () => {
    const app = await renderSettings();
    const saved = within(card('Provider ollama-local'));
    expect(saved.getByRole('textbox', { name: 'Identifier' })).toHaveProperty('readOnly', true);
    expect(saved.getByRole('combobox', { name: 'Type' })).toHaveProperty('disabled', true);

    await app.user.click(screen.getByRole('button', { name: 'Add a provider' }));
    const added = within(card('Provider provider'));
    await choose(app.user, added.getByRole('combobox', { name: 'Type' }), 'Anthropic');
    expect(added.getByRole('textbox', { name: 'Environment variable' })).toHaveProperty(
      'value',
      'ANTHROPIC_API_KEY',
    );
    const id = added.getByRole('textbox', { name: 'Identifier' });
    await app.user.clear(id);
    await app.user.type(id, 'claude');
    expect(card('Provider claude')).toBeDefined();
  });

  it('PRV-005: headers show as they are, and say an API key goes under API key', async () => {
    await renderSettings(
      machineConfig({
        providers: [
          ollama,
          {
            id: 'lm-studio',
            type: 'openai-compatible',
            baseUrl: 'http://localhost:1234/v1',
            deviceId: 'macbook-gpu',
            headers: { 'X-Title': 'Mythos' },
          },
        ],
      }),
    );
    const studio = within(card('Provider lm-studio'));
    expect(studio.getByText(/Put an API key under API key, not here/)).toBeDefined();
    expect(studio.getByRole('textbox', { name: 'Header name' })).toHaveProperty('value', 'X-Title');
    expect(studio.getByRole('textbox', { name: 'Header value' })).toHaveProperty('value', 'Mythos');
    expect(
      within(region('Providers')).getByRole('combobox', { name: 'API key from' }).textContent,
    ).toContain('No key');
  });
});
