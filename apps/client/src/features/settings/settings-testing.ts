// Helpers for the settings screen's tests. Not imported by the app.
import type { MachineConfig } from '@mythos/contracts';
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { answer, fetchCalls } from '@/test/fake-fetch';
import { renderApp } from '@/test/render-app';
import { machineConfig, providerStatuses } from '@/test/settings-fixtures';

/**
 * Renders the app at /settings with `GET /settings` answering `config` and
 * `GET /settings/providers` answering `statuses`, and waits for the form.
 */
export async function renderSettings(
  config: MachineConfig = machineConfig(),
  statuses = providerStatuses(),
) {
  answer('GET', '/api/settings', { status: 200, body: config });
  answer('GET', '/api/settings/providers', { status: 200, body: statuses });
  const app = renderApp('/settings');
  await screen.findByRole('region', { name: 'Providers' });
  return app;
}

/** A section of the screen, by its heading. */
export function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** A device, provider, or profile card, by its heading, such as "Provider ollama-local". */
export function card(name: string): HTMLElement {
  return screen.getByRole('group', { name });
}

/** The text of everything a control's aria-describedby points at: notes, warning, issues. */
export function describedText(control: HTMLElement): string {
  const ids = (control.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
}

/** The body of the last request sent to `method url`. */
export function lastBody(method: string, url: string): unknown {
  const calls = fetchCalls().filter((call) => call.method === method && call.url === url);
  return calls.at(-1)?.body;
}

/** Opens a Radix Select and picks the option with `name`. */
export async function choose(user: UserEvent, combobox: HTMLElement, name: string): Promise<void> {
  await user.click(combobox);
  await user.click(await screen.findByRole('option', { name }));
}

/** Answers `PUT /settings` with the config as the server would save it. */
export function answerSave(config: MachineConfig, restartRequired = false): void {
  answer('PUT', '/api/settings', { status: 200, body: { config, restartRequired } });
}
