import { render } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { App, createApp } from '@/app/app';
import { routes } from '@/app/router';

/**
 * Renders the whole app at `path`, wired as main.tsx wires it but with a memory router.
 * Returns the router and query client, so tests can read where the app went and what it
 * cached, and a user-event session.
 */
export function renderApp(path: string) {
  const app = createApp(createMemoryRouter(routes, { initialEntries: [path] }));
  const user = userEvent.setup();
  const view = render(<App {...app} />);
  return { ...app, user, view };
}

/** Where the app is now: path and query string. */
export function currentPath(app: ReturnType<typeof renderApp>): string {
  const { pathname, search } = app.router.state.location;
  return pathname + search;
}
