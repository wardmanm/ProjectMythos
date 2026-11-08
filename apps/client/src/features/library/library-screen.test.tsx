import type { CampaignSummary, MachineConfig, PackSummary } from '@mythos/contracts';
import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { queryKeys } from '@/api/query-keys';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { campaignView } from '@/test/fixtures';
import { currentPath, renderApp } from '@/test/render-app';
import { machineConfig } from '@/test/settings-fixtures';
import {
  brokenPack,
  campaignId,
  campaignSummary,
  otherCampaignId,
  referencePack,
  saltmarshPack,
} from './testing';

const merrow = campaignSummary({
  campaignId: otherCampaignId,
  name: 'Wreck of the Merrow',
  gameTimeLabel: 'Tuesday, October 13, 1874, night',
  lastPlayedAt: '2026-11-06T21:30:00Z',
});

/** What the server answers for the library: settings, campaigns, and packs. */
function serveLibrary(
  answers: { settings?: MachineConfig; campaigns?: CampaignSummary[]; packs?: PackSummary[] } = {},
): void {
  answer('GET', '/api/settings', { status: 200, body: answers.settings ?? machineConfig() });
  answer('GET', '/api/campaigns', {
    status: 200,
    body: answers.campaigns ?? [campaignSummary()],
  });
  answer('GET', '/api/packs', { status: 200, body: answers.packs ?? [referencePack()] });
}

async function findCard(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 2, name });
  const card = heading.closest('li');
  if (card === null) throw new Error(`no card for ${name}`);
  return card;
}

/** A card's details, term by term. */
function detailsOf(card: HTMLElement): Record<string, string> {
  const terms = [...card.querySelectorAll('dt')];
  return Object.fromEntries(
    terms.map((term) => [term.textContent, term.nextElementSibling?.textContent ?? '']),
  );
}

async function openDeleteDialog(app: ReturnType<typeof renderApp>, name: string) {
  const card = await findCard(name);
  await app.user.click(within(card).getByRole('button', { name: 'Delete' }));
  return screen.findByRole('alertdialog', { name: `Delete ${name}?` });
}

describe('LibraryScreen', () => {
  it("UI-083: campaigns are listed in the server's order, most recently played first, each with its name, setting, date in game, and last played", async () => {
    serveLibrary({ campaigns: [merrow, campaignSummary()] });
    renderApp('/');
    const list = await screen.findByRole('list', { name: 'Campaigns' });
    const cards = within(list).getAllByRole('listitem');
    const names = cards.map((card) => within(card).getByRole('heading').textContent);
    expect(names).toEqual(['Wreck of the Merrow', 'Brinemoor: Arrival']);
    expect(detailsOf(cards[0]!)).toMatchObject({
      Setting: 'Brinemoor',
      'In game': 'Tuesday, October 13, 1874, night',
    });
    // The words depend on the device's locale; the machine-readable date doesn't.
    const lastPlayed = cards.map((card) => card.querySelector('time')?.getAttribute('datetime'));
    expect(lastPlayed).toEqual(['2026-11-06T21:30:00Z', '2026-11-05T10:00:00Z']);
    expect(screen.getByRole('link', { name: 'New campaign' }).getAttribute('href')).toBe('/new');
  });

  it("UI-083: Continue is each campaign's primary action, and it opens the play screen", async () => {
    serveLibrary();
    answer('GET', `/api/campaigns/${campaignId}`, { status: 200, body: campaignView() });
    const app = renderApp('/');
    const card = await findCard('Brinemoor: Arrival');
    const continueLink = within(card).getByRole('link', { name: 'Continue' });
    expect(continueLink.className).toContain('bg-primary');
    expect(within(card).getByRole('button', { name: 'Delete' }).className).not.toContain(
      'bg-primary',
    );
    await app.user.click(continueLink);
    await waitFor(() => {
      expect(currentPath(app)).toBe(`/c/${campaignId}`);
    });
  });

  it('UI-083: the campaigns are one column on phones and a grid from 640 px', async () => {
    serveLibrary({ campaigns: [merrow, campaignSummary()] });
    renderApp('/');
    // jsdom does no layout, so this reads the classes that set the columns.
    const list = await screen.findByRole('list', { name: 'Campaigns' });
    expect(list.className.split(' ')).toEqual(
      expect.arrayContaining(['grid', 'grid-cols-1', 'sm:grid-cols-2', 'lg:grid-cols-3']),
    );
  });

  it("UI-083: packs with errors are listed with each error's file, path, and message", async () => {
    serveLibrary({ packs: [referencePack(), brokenPack()] });
    renderApp('/');
    const section = await screen.findByRole('region', { name: 'Packs with errors' });
    expect(within(section).getByRole('heading', { name: 'Broken Coast' })).toBeDefined();
    const list = within(section).getByRole('list', { name: 'Errors in Broken Coast' });
    const issues = within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(issues).toEqual([
      'entities/items/item.lantern.json at startingLocation.slot: "belt" is not a slot in slots.everyday',
      'setting.json: The file is not valid JSON.',
    ]);
    expect(within(section).queryByText('Brinemoor (Reference Pack)')).toBeNull();
  });

  it('UI-083: packs with errors are listed in an empty library too, and not at all when none has any', async () => {
    serveLibrary({ campaigns: [], packs: [brokenPack()] });
    const app = renderApp('/');
    expect(await screen.findByRole('region', { name: 'Packs with errors' })).toBeDefined();
    app.view.unmount();

    serveLibrary({ packs: [referencePack()] });
    renderApp('/');
    await findCard('Brinemoor: Arrival');
    expect(screen.queryByRole('heading', { name: 'Packs with errors' })).toBeNull();
  });

  it('UI-083: Delete asks first, and Cancel deletes nothing', async () => {
    serveLibrary();
    const app = renderApp('/');
    const dialog = await openDeleteDialog(app, 'Brinemoor: Arrival');
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);
    expect(dialog.textContent).toContain("It can't be undone.");
    await app.user.click(cancel);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(fetchCalls().filter((call) => call.method === 'DELETE')).toEqual([]);
    expect(await findCard('Brinemoor: Arrival')).toBeDefined();
  });

  it('UI-083: a confirmed delete removes the campaign from the list, and says so', async () => {
    serveLibrary({ campaigns: [campaignSummary(), merrow] });
    answer('DELETE', `/api/campaigns/${campaignId}`, { status: 204 });
    const app = renderApp('/');
    app.queryClient.setQueryData(queryKeys.campaign(campaignId), campaignView());
    const dialog = await openDeleteDialog(app, 'Brinemoor: Arrival');

    answer('GET', '/api/campaigns', { status: 200, body: [merrow] });
    await app.user.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.queryByRole('heading', { name: 'Brinemoor: Arrival' })).toBeNull();
    expect(await findCard('Wreck of the Merrow')).toBeDefined();
    expect(screen.getByRole('status').textContent).toContain('Deleted Brinemoor: Arrival.');
    expect(app.queryClient.getQueryData(queryKeys.campaign(campaignId))).toBeUndefined();
  });

  it('UI-083, UI-122: a campaign that is narrating is not deleted, and the dialog says to stop it or wait', async () => {
    serveLibrary();
    answer('DELETE', `/api/campaigns/${campaignId}`, {
      status: 409,
      body: { error: { code: 'turn_in_progress', message: 'a narration is running' } },
    });
    const app = renderApp('/');
    const dialog = await openDeleteDialog(app, 'Brinemoor: Arrival');
    await app.user.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain(
      'This campaign is still narrating. Open it and press Stop, or let the narration finish, then delete it.',
    );
    expect(alert.textContent).not.toContain('turn_in_progress');
    const open = within(alert).getByRole('link', { name: 'Open Brinemoor: Arrival' });
    expect(open.getAttribute('href')).toBe(`/c/${campaignId}`);
    expect(screen.getByRole('alertdialog')).toBe(dialog);
  });

  it('UI-083: a campaign already deleted elsewhere is gone from the list, with a word to say so', async () => {
    serveLibrary();
    answer('DELETE', `/api/campaigns/${campaignId}`, {
      status: 404,
      body: { error: { code: 'not_found', message: 'no such campaign' } },
    });
    const app = renderApp('/');
    const dialog = await openDeleteDialog(app, 'Brinemoor: Arrival');

    answer('GET', '/api/campaigns', { status: 200, body: [] });
    await app.user.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));
    expect(await screen.findByRole('link', { name: 'Start your first campaign' })).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('That campaign was already deleted.');
  });

  it('CSET-023: each campaign shows a one-line summary of its content settings', async () => {
    const settings = { ...campaignSummary().contentSettings, lines: ['harm to animals'] };
    serveLibrary({ campaigns: [campaignSummary({ contentSettings: settings })] });
    renderApp('/');
    const card = await findCard('Brinemoor: Arrival');
    expect(detailsOf(card)['Content']).toBe(
      'Violence moderate, gore fade to black, sexual content off, language moderate, disturbing themes moderate; 1 line, 0 veils',
    );
  });

  it('UI-123: an empty library says "Start your first campaign", which opens the form with the reference pack preselected', async () => {
    serveLibrary({ campaigns: [], packs: [saltmarshPack(), referencePack()] });
    const app = renderApp('/');
    const start = await screen.findByRole('link', { name: 'Start your first campaign' });
    expect(screen.getByText('You have no campaigns yet.')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'New campaign' })).toBeNull();
    await app.user.click(start);
    expect(currentPath(app)).toBe('/new');
    const pack = await screen.findByRole('combobox', { name: 'Pack' });
    expect(pack.textContent).toContain('Brinemoor (Reference Pack)');
  });

  it('PRV-001: while no model profile exists, the library opens Settings instead, replacing the address', async () => {
    serveLibrary({ settings: machineConfig({ modelProfiles: [], roles: {} }) });
    const app = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeDefined();
    expect(currentPath(app)).toBe('/settings');
    expect(app.router.state.historyAction).toBe('REPLACE');
  });

  it('PRV-001: with profiles but no narrator, the library shows a notice linking to Settings', async () => {
    serveLibrary({ settings: machineConfig({ roles: {} }) });
    renderApp('/');
    expect(
      await screen.findByText(
        'No model is assigned to narrate. Assign one in Settings before you play.',
      ),
    ).toBeDefined();
    const link = screen.getByRole('link', { name: 'Open settings' });
    expect(link.getAttribute('href')).toBe('/settings');
    expect(await findCard('Brinemoor: Arrival')).toBeDefined();
  });

  it('PRV-001: settings cached before a profile was saved do not send the library to Settings', async () => {
    serveLibrary();
    const app = renderApp('/no/such/page');
    await screen.findByRole('heading', { name: "There's no page here" });
    const firstStart = machineConfig({ modelProfiles: [], roles: {} });
    app.queryClient.setQueryData(queryKeys.settings(), firstStart);
    const visited: string[] = [];
    app.router.subscribe((state) => {
      visited.push(state.location.pathname);
    });

    await act(async () => {
      await app.router.navigate('/');
    });
    expect(await findCard('Brinemoor: Arrival')).toBeDefined();
    expect(visited).not.toContain('/settings');
    expect(currentPath(app)).toBe('/');
  });

  it("PRV-001: when settings can't be read, the library still shows the campaigns", async () => {
    serveLibrary();
    answer('GET', '/api/settings', {
      status: 500,
      body: { error: { code: 'internal_error', message: 'disk on fire' } },
    });
    renderApp('/');
    expect(await findCard('Brinemoor: Arrival')).toBeDefined();
    expect(screen.queryByText(/No model is assigned/)).toBeNull();
  });
});
