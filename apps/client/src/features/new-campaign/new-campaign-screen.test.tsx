import type { MachineConfig, PackSummary } from '@mythos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  brokenPack,
  otherCampaignId,
  referencePack,
  saltmarshPack,
} from '@/features/library/testing';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { campaignView } from '@/test/fixtures';
import { currentPath, renderApp } from '@/test/render-app';
import { machineConfig } from '@/test/settings-fixtures';

/** What the server answers for the form: the packs and the machine config. */
function serveForm(answers: { packs?: PackSummary[]; settings?: MachineConfig } = {}): void {
  answer('GET', '/api/packs', { status: 200, body: answers.packs ?? [referencePack()] });
  answer('GET', '/api/settings', { status: 200, body: answers.settings ?? machineConfig() });
}

/** A successful start: the new campaign's view, which the play screen then reads. */
function serveStart(name = 'Brinemoor: Arrival'): void {
  const view = campaignView({ campaignId: otherCampaignId, name });
  answer('POST', '/api/campaigns', { status: 200, body: view });
  answer('GET', `/api/campaigns/${otherCampaignId}`, { status: 200, body: view });
}

/** The read-only details, term by term. */
function details(): Record<string, string> {
  const terms = [...document.querySelectorAll('form dt')];
  return Object.fromEntries(
    terms.map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  );
}

/** The text of whatever a field's `aria-describedby` names. */
function describedBy(field: HTMLElement): string | undefined {
  const id = field.getAttribute('aria-describedby');
  return id === null ? undefined : (document.getElementById(id)?.textContent ?? undefined);
}

function posts() {
  return fetchCalls().filter((call) => call.method === 'POST');
}

describe('NewCampaignScreen', () => {
  it('UI-123: the reference pack is preselected even when another pack is listed first, and its premade PC is shown read-only', async () => {
    serveForm({ packs: [saltmarshPack(), referencePack()] });
    renderApp('/new');
    const pack = await screen.findByRole('combobox', { name: 'Pack' });
    expect(pack.textContent).toContain('Brinemoor (Reference Pack)');
    expect(screen.getByRole('combobox', { name: 'Scenario' }).textContent).toContain('Arrival');
    expect(
      screen.getByText(
        'You arrive in Brinemoor on the evening coach, looking for your missing brother.',
      ),
    ).toBeDefined();
    expect(details()).toEqual({
      Character: 'Wren Ashby',
      'Tone profile': 'Coastal Mystery',
      Ruleset: 'Standard',
    });
    expect(screen.getAllByRole('textbox').map((field) => field.id)).toEqual(['campaign-name']);
  });

  it("SCH-110, CON-112: Start sends the name, pack, scenario, the setting's tone profile and ruleset, and the premade PC, then opens the play screen", async () => {
    serveForm();
    serveStart('Wren in Brinemoor');
    const app = renderApp('/new');
    const name = await screen.findByLabelText<HTMLInputElement>('Campaign name');
    expect(name.value).toBe('Brinemoor: Arrival');
    await app.user.clear(name);
    await app.user.type(name, 'Wren in Brinemoor');
    await app.user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(currentPath(app)).toBe(`/c/${otherCampaignId}`);
    });
    expect(app.router.state.historyAction).toBe('REPLACE');
    expect(posts()).toEqual([
      {
        method: 'POST',
        url: '/api/campaigns',
        body: {
          name: 'Wren in Brinemoor',
          packId: 'reference',
          scenarioId: 'scenario.arrival',
          toneProfileId: 'tone.coastal-mystery',
          rulesetId: 'ruleset.standard',
          conversion: null,
          pc: { mode: 'premade' },
        },
      },
    ]);
  });

  it('SCH-102: a pack with errors is not offered', async () => {
    serveForm({ packs: [brokenPack(), referencePack(), saltmarshPack()] });
    const app = renderApp('/new');
    await app.user.click(await screen.findByRole('combobox', { name: 'Pack' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Brinemoor (Reference Pack)',
      'Saltmarsh',
    ]);
  });

  it('SCH-102: with no pack that can start a campaign, the form says so and links to the library', async () => {
    serveForm({ packs: [brokenPack()] });
    renderApp('/new');
    expect(await screen.findByText(/^No pack can start a campaign yet\./)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Go to the library' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('SCH-110: another pack starts at its first scenario with a premade PC, with its own defaults', async () => {
    serveForm({ packs: [referencePack(), saltmarshPack()] });
    serveStart();
    const app = renderApp('/new');
    await app.user.click(await screen.findByRole('combobox', { name: 'Pack' }));
    await app.user.click(await screen.findByRole('option', { name: 'Saltmarsh' }));

    const scenario = screen.getByRole('combobox', { name: 'Scenario' });
    expect(scenario.textContent).toContain('Low Tide');
    expect(screen.getByLabelText<HTMLInputElement>('Campaign name').value).toBe(
      'The Saltmarsh: Low Tide',
    );
    expect(details()).toEqual({
      Character: 'Marn Tull',
      'Tone profile': 'Adventure',
      Ruleset: 'd20',
    });
    await app.user.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(posts()[0]?.body).toMatchObject({
        packId: 'saltmarsh',
        scenarioId: 'scenario.low-tide',
        toneProfileId: 'tone.adventure',
        rulesetId: 'ruleset.d20',
      });
    });
  });

  it("SCH-110: a pack whose setting names no tone profile can't start from this form", async () => {
    const toneless = referencePack({
      defaults: { toneProfileId: null, rulesetId: 'ruleset.standard' },
    });
    serveForm({ packs: [toneless] });
    renderApp('/new');
    expect(await screen.findByText(/names no tone profile/)).toBeDefined();
    expect(details()['Tone profile']).toBe('None');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start' }).disabled).toBe(true);
  });

  it('CON-112: every issue the server reports is shown, at its field when it has one', async () => {
    serveForm();
    const toneIssue = '"tone.coastal-mystery" is not a tone profile pack reference offers';
    const scenarioIssue = '"scenario.arrival" is not a scenario in pack reference';
    answer('POST', '/api/campaigns', {
      status: 400,
      body: {
        error: {
          code: 'validation_failed',
          message: 'The command has 3 issues.',
          details: {
            issues: [
              { path: 'name', message: 'Too long' },
              { path: 'scenarioId', message: scenarioIssue },
              { path: 'toneProfileId', message: toneIssue },
            ],
          },
        },
      },
    });
    const app = renderApp('/new');
    await app.user.click(await screen.findByRole('button', { name: 'Start' }));

    const name = screen.getByLabelText('Campaign name');
    await waitFor(() => {
      expect(name.getAttribute('aria-invalid')).toBe('true');
    });
    expect(describedBy(name)).toBe('Too long');
    const scenario = screen.getByRole('combobox', { name: 'Scenario' });
    expect(scenario.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(scenario)).toBe(scenarioIssue);
    const alert = screen.getByRole('alert');
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([toneIssue]);
    expect(screen.queryByText('The command has 3 issues.')).toBeNull();
    expect(currentPath(app)).toBe('/new');
  });

  it('UI-122: a blank name says to give the campaign a name, and sends nothing', async () => {
    serveForm();
    const app = renderApp('/new');
    const name = await screen.findByLabelText('Campaign name');
    await app.user.clear(name);
    await app.user.type(name, '   ');
    await app.user.click(screen.getByRole('button', { name: 'Start' }));
    expect(describedBy(name)).toBe('Give the campaign a name.');
    expect(posts()).toEqual([]);
  });

  it('UI-122: a start that fails for another reason says so in plain words', async () => {
    serveForm();
    answer('POST', '/api/campaigns', {
      status: 500,
      body: { error: { code: 'internal_error', message: 'ENOSPC: no space left on device' } },
    });
    const app = renderApp('/new');
    await app.user.click(await screen.findByRole('button', { name: 'Start' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Something went wrong on the server.');
    expect(alert.textContent).not.toContain('ENOSPC');
  });

  it('PRV-001: with no narrator, the form warns and links to Settings, and Start still works', async () => {
    serveForm({ settings: machineConfig({ roles: {} }) });
    serveStart();
    const app = renderApp('/new');
    expect(
      await screen.findByText(
        'No model is assigned to narrate. Assign one in Settings before you play.',
      ),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Open settings' }).getAttribute('href')).toBe(
      '/settings',
    );
    await app.user.click(await screen.findByRole('button', { name: 'Start' }));
    await waitFor(() => {
      expect(currentPath(app)).toBe(`/c/${otherCampaignId}`);
    });
  });
});
