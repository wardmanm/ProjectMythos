import { createBrowserRouter, type RouteObject } from 'react-router';
import { InspectorScreen } from '@/features/inspector/inspector-screen';
import { LibraryScreen } from '@/features/library/library-screen';
import { NewCampaignScreen } from '@/features/new-campaign/new-campaign-screen';
import { PinScreen } from '@/features/pin/pin-screen';
import { PlayScreen } from '@/features/play/play-screen';
import { SettingsScreen } from '@/features/settings/settings-screen';
import { AppShell } from './app-shell';
import { CampaignLayout } from './campaign-layout';
import { NotFoundScreen } from './not-found-screen';

/**
 * The phase-1 routes of 14-ui §2. Implements UI-001: the URL is the only navigation
 * state, so any screen renders from its URL alone. Tests mount the same table in a
 * memory router.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <LibraryScreen /> },
      { path: 'new', element: <NewCampaignScreen /> },
      { path: 'settings', element: <SettingsScreen /> },
      { path: 'pin', element: <PinScreen /> },
      {
        path: 'c/:campaignId',
        element: <CampaignLayout />,
        children: [
          { index: true, element: <PlayScreen /> },
          { path: 'inspector/:turnId', element: <InspectorScreen /> },
        ],
      },
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
];

export type AppRouter = ReturnType<typeof createBrowserRouter>;

/** The browser's router for the app. */
export function createAppRouter(): AppRouter {
  return createBrowserRouter(routes);
}
