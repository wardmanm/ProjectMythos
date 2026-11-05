import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { currentPath, renderApp } from '@/test/render-app';

describe('AppShell', () => {
  it('UI-110: every shell control is reachable with Tab, in order', async () => {
    const app = renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    const controls = [
      screen.getByRole('button', { name: 'Menu' }),
      screen.getByRole('link', { name: 'Mythos' }),
    ];
    for (const control of controls) {
      await app.user.tab();
      expect(document.activeElement).toBe(control);
    }
  });

  it('UI-110: the menu opens and is operated by keyboard alone', async () => {
    const app = renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    await app.user.tab();
    await app.user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Library' })).toBeDefined();
    await app.user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Settings' }));
    await app.user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeDefined();
    expect(currentPath(app)).toBe('/settings');
  });

  it('UI-110: shell controls are 44 px targets with an accent focus ring', async () => {
    renderApp('/');
    await screen.findByRole('heading', { name: 'Library' });
    // jsdom does no layout, so this reads the classes that set the size and the ring.
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.className).toContain('size-11');
    expect(menu.className).toContain('focus-visible:ring-ring');
    expect(screen.getByRole('link', { name: 'Mythos' }).className).toContain('min-h-11');
  });
});
