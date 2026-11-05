import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { branchId, campaignId, campaignView, turnId } from '@/test/fixtures';
import { renderApp } from '@/test/render-app';

const screens: [path: string, heading: string][] = [
  ['/', 'Library'],
  ['/new', 'New campaign'],
  ['/settings', 'Settings'],
  ['/pin?next=%2F', 'Enter the PIN'],
  [`/c/${campaignId}`, 'Brinemoor: Arrival'],
  [`/c/${campaignId}/inspector/${turnId}`, 'Inspector'],
  ['/no/such/page', "There's no page here"],
];

describe('routes', () => {
  it('UI-001: every route renders its screen from the URL alone', async () => {
    answer('GET', `/api/campaigns/${campaignId}`, { status: 200, body: campaignView() });
    for (const [path, heading] of screens) {
      const app = renderApp(path);
      expect(await screen.findByRole('heading', { level: 1, name: heading }), path).toBeDefined();
      app.view.unmount();
    }
  });

  it("UI-001: Play shows the campaign's current branch, which its campaign view names", async () => {
    answer('GET', `/api/campaigns/${campaignId}`, { status: 200, body: campaignView() });
    renderApp(`/c/${campaignId}`);
    const heading = await screen.findByRole('heading', { name: 'Brinemoor: Arrival' });
    expect(heading.closest('[data-branch-id]')?.getAttribute('data-branch-id')).toBe(branchId);
    expect(fetchCalls().map((call) => call.url)).toContain(`/api/campaigns/${campaignId}`);
  });

  it('UI-120: no label on the shell or a screen is in capitals', async () => {
    answer('GET', `/api/campaigns/${campaignId}`, { status: 200, body: campaignView() });
    for (const [path, heading] of screens) {
      const app = renderApp(path);
      await screen.findByRole('heading', { level: 1, name: heading });
      const labelled = document.body.querySelectorAll('h1, h2, h3, a, button, label, p');
      for (const element of labelled) {
        const words = element.textContent.replace(/\bPIN\b/g, '').trim();
        const hasLetters = /[A-Za-z]{2}/.test(words);
        expect(hasLetters && words === words.toUpperCase(), `${path}: "${words}"`).toBe(false);
        expect(element.getAttribute('aria-label') ?? '', path).not.toMatch(/^[A-Z\s]{2,}$/);
      }
      expect(document.body.innerHTML, path).not.toContain('uppercase');
      app.view.unmount();
    }
  });
});
