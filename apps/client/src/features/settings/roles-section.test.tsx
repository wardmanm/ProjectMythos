import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { machineConfig } from '@/test/settings-fixtures';
import { answerSave, choose, lastBody, region, renderSettings } from './settings-testing';

const qwen = {
  id: 'qwen-local',
  providerId: 'ollama-local',
  model: 'qwen3.6:35b-a3b',
  kind: 'text',
  contextWindow: 32768,
  maxOutputTokens: 2048,
  structuredOutput: 'json-schema',
} as const;
const llama = { ...qwen, id: 'llama-local', model: 'llama4:8b' };
const embed = {
  ...qwen,
  id: 'embed-local',
  model: 'nomic-embed-text',
  kind: 'embedding',
  contextWindow: 8192,
  maxOutputTokens: 1,
  structuredOutput: 'prompt-only',
  embeddingDimensions: 768,
} as const;

function role(name: string): HTMLElement {
  return within(region('Roles')).getByRole('combobox', { name });
}

async function optionsOf(user: UserEvent, name: string): Promise<(string | null)[]> {
  await user.click(role(name));
  const options = screen.getAllByRole('option').map((option) => option.textContent);
  await user.keyboard('{Escape}');
  return options;
}

describe('RolesSection', () => {
  it('PRV-001, PRV-009, PRV-015: an unassigned role says what it falls back to', async () => {
    await renderSettings();
    expect(role('NPC voice').textContent).toContain("Use the narrator's (qwen-local)");
    expect(role('Speech segmenter').textContent).toContain("Use the extractor's");
    expect(role('Illustrator').textContent).toContain('Image prompts from templates only');
    expect(role('Adjudicator').textContent).toContain('Unassigned');
    expect(role('Narrator').textContent).toContain('qwen-local');
  });

  it('PRV-002: the embedder offers embedding profiles, and every other role text profiles', async () => {
    const app = await renderSettings(
      machineConfig({
        modelProfiles: [qwen, llama, embed],
        roles: { narrator: { profileId: 'qwen-local' } },
      }),
    );
    expect(await optionsOf(app.user, 'Embedder')).toEqual([
      'Unassigned',
      'embed-local (nomic-embed-text)',
    ]);
    expect(await optionsOf(app.user, 'Narrator')).toEqual([
      'Unassigned',
      'qwen-local (qwen3.6:35b-a3b)',
      'llama-local (llama4:8b)',
    ]);
  });

  it("PRV-003: choosing a profile keeps the role's own sampling, and Unassigned saves null", async () => {
    const app = await renderSettings(
      machineConfig({
        modelProfiles: [qwen, llama],
        roles: {
          narrator: { profileId: 'qwen-local', sampling: { temperature: 0.8 } },
          adjudicator: { profileId: 'qwen-local' },
        },
      }),
    );
    await choose(app.user, role('Narrator'), 'llama-local (llama4:8b)');
    await choose(app.user, role('Adjudicator'), 'Unassigned');
    answerSave(machineConfig());
    await app.user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved.');

    expect(lastBody('PUT', '/api/settings')).toMatchObject({
      roles: {
        narrator: { profileId: 'llama-local', sampling: { temperature: 0.8 } },
        adjudicator: null,
      },
    });
  });

  it('UI-123: with no profile and no narrator, the screen says what to do next', async () => {
    await renderSettings(machineConfig({ modelProfiles: [], roles: {} }));
    expect(
      within(region('Model profiles')).getByText('Add a model profile so Mythos can narrate.'),
    ).toBeDefined();
    expect(
      within(region('Roles')).getByText('Assign the narrator to start playing.'),
    ).toBeDefined();
  });
});
