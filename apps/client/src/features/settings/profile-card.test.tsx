import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { machineConfig, probeResult } from '@/test/settings-fixtures';
import { contextWindowWarning, MIN_CONTEXT_WINDOW } from './profile-card';
import { schemaDefaults } from './schema-defaults';
import { answerSave, card, choose, describedText, renderSettings } from './settings-testing';

const probeUrl = '/api/settings/profiles/qwen-local/probe';
const qwen = () => within(card('Model profile qwen-local'));

describe('ProfileCard', () => {
  it('PRV-090: probe results render with their suggestions', async () => {
    const app = await renderSettings();
    answer('POST', probeUrl, {
      status: 200,
      body: probeResult({
        structuredMethods: { 'json-schema': false, 'tool-call': true },
        emittedThinking: true,
        suggestions: [
          'Use tool-call: json-schema output did not parse.',
          'Turn thinking off in the server settings for this model.',
        ],
      }),
    });
    await app.user.click(qwen().getByRole('button', { name: 'Probe' }));

    const report = await qwen().findByRole('group', { name: 'Probe result' });
    const text = report.textContent;
    expect(text).toContain('JSON schemaNo valid output');
    expect(text).toContain('Tool callValid output');
    expect(text).toContain('Prompt onlyNot tried');
    expect(text).toContain('About 812 tokens a second');
    expect(text).toContain('About 45 tokens a second');
    expect(text).toContain('The model thought before answering');
    const suggestions = within(report)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(suggestions).toEqual([
      'Use tool-call: json-schema output did not parse.',
      'Turn thinking off in the server settings for this model.',
    ]);
  });

  it('PRV-090: Probe waits until the profile and its provider are saved', async () => {
    const app = await renderSettings();
    expect(qwen().getByRole('button', { name: 'Probe' })).toHaveProperty('disabled', false);

    const window = qwen().getByRole('textbox', { name: 'Context window, in tokens' });
    await app.user.type(window, '0');
    expect(qwen().getByRole('button', { name: 'Probe' })).toHaveProperty('disabled', true);
    expect(qwen().getByText('Save your changes to probe this profile.')).toBeDefined();

    await app.user.click(screen.getByRole('button', { name: 'Discard' }));
    const address = within(card('Provider ollama-local')).getByRole('textbox', {
      name: 'Server address',
    });
    await app.user.type(address, '/');
    expect(qwen().getByRole('button', { name: 'Probe' })).toHaveProperty('disabled', true);
  });

  it('PRV-090: Cancel stops a probe, and no failure shows', async () => {
    answer('GET', '/api/settings/providers/ollama-local/models', { status: 200, body: [] });
    const app = await renderSettings();
    let signal: AbortSignal | undefined;
    const fakeFetch = globalThis.fetch;
    vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
      if (url !== probeUrl) return fakeFetch(url, init);
      signal = init.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });
    await app.user.click(qwen().getByRole('button', { name: 'Probe' }));
    expect(await qwen().findByText('Probing… this can take a minute.')).toBeDefined();

    await app.user.click(qwen().getByRole('button', { name: 'Cancel' }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() => {
      expect(qwen().getByRole('button', { name: 'Probe' })).toHaveProperty('disabled', false);
    });
    expect(qwen().queryByText(/Probing/)).toBeNull();
    expect(within(card('Model profile qwen-local')).queryByRole('alert')).toBeNull();
  });

  it("PRV-091: the model picker lists the provider's models and sets the model", async () => {
    answer('GET', '/api/settings/providers/ollama-local/models', {
      status: 200,
      body: ['qwen3.6:35b-a3b', 'llama4:8b'],
    });
    const app = await renderSettings();
    const picker = await qwen().findByRole('combobox', {
      name: "Choose from the provider's models",
    });
    await choose(app.user, picker, 'llama4:8b');

    expect(qwen().getByRole('textbox', { name: 'Model' })).toHaveProperty('value', 'llama4:8b');
    answerSave(machineConfig());
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');
  });

  it('PRV-091: a profile on an unsaved provider says to save it before listing models', async () => {
    const app = await renderSettings();
    await app.user.click(screen.getByRole('button', { name: 'Add a provider' }));
    await app.user.click(screen.getByRole('button', { name: 'Add a model profile' }));
    const added = within(card('Model profile profile'));
    await choose(app.user, added.getByRole('combobox', { name: 'Provider' }), 'provider (ollama)');

    expect(added.getByText('Save the provider to list its models.')).toBeDefined();
    expect(fetchCalls().map((call) => call.url)).not.toContain(
      '/api/settings/providers/provider/models',
    );
  });

  it('CTX-032: a text profile below 8,192 tokens warns, and an embedding profile does not', async () => {
    const app = await renderSettings();
    const window = qwen().getByRole('textbox', { name: 'Context window, in tokens' });
    await app.user.clear(window);
    await app.user.type(window, '4096');
    expect(describedText(window)).toContain(
      'Below 8,192 tokens, prompts may not fit and turns can fail.',
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false);

    await choose(
      app.user,
      qwen().getByRole('combobox', { name: 'Kind' }),
      'Embedding: finding memories',
    );
    expect(describedText(window)).not.toContain('Below 8,192 tokens');
  });

  it('CTX-032: the warning starts at 8,192 tokens and below', () => {
    const profile = { ...schemaDefaults.profile, kind: 'text' as const };
    expect(MIN_CONTEXT_WINDOW).toBe(8_192);
    expect(contextWindowWarning({ ...profile, contextWindow: 8_192 })).toBeNull();
    expect(contextWindowWarning({ ...profile, contextWindow: 8_191 })).not.toBeNull();
    expect(contextWindowWarning({ ...profile, contextWindow: Number.NaN })).toBeNull();
  });

  it("UI-088: an Anthropic profile with thinking off suggests the provider's default", async () => {
    await renderSettings(
      machineConfig({
        devices: [{ id: 'cloud', name: 'Cloud APIs' }],
        providers: [
          { id: 'anthropic', type: 'anthropic', deviceId: 'cloud', apiKey: { env: 'KEY' } },
        ],
        modelProfiles: [
          {
            id: 'claude',
            providerId: 'anthropic',
            model: 'claude-sonnet-5-5',
            kind: 'text',
            contextWindow: 200_000,
            maxOutputTokens: 4_096,
            structuredOutput: 'tool-call',
            thinking: 'off',
          },
        ],
        roles: {},
      }),
      [],
    );
    const thinking = within(card('Model profile claude')).getByRole('combobox', {
      name: 'Thinking',
    });
    expect(describedText(thinking)).toContain("can't turn thinking off");
  });
});
