import { MenuIcon } from 'lucide-react';
import { Link, Outlet, useMatch } from 'react-router';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CampaignTopBar } from '@/features/play/campaign-top-bar';

/**
 * The layout every screen sits in: a top bar with the menu, then the screen, then the
 * notice line. The top bar stays at the top as the page scrolls. On a campaign's screens
 * it shows the campaign's name and date in game; elsewhere, the app's name (14-ui
 * Decisions). Phone first: nothing has a fixed width, and the content area may shrink
 * below its children's widths, so no screen scrolls sideways (UI-042). The content area
 * fills the height the bar and notice leave, so a screen can fill it too. Every control
 * is a 44 px target reachable with Tab (UI-110, CONV-103).
 */
export function AppShell() {
  const campaignId = useMatch('/c/:campaignId/*')?.params.campaignId ?? null;
  const appName = (
    <Link
      to="/"
      className="inline-flex min-h-11 items-center rounded-md px-2 font-display text-lg text-text"
    >
      Mythos
    </Link>
  );
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr_auto] bg-background font-interface text-text">
      <header className="sticky top-0 z-20 flex min-w-0 items-center gap-2 border-b border-border bg-surface px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Menu">
              <MenuIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-48">
            <DropdownMenuItem asChild>
              <Link to="/">Library</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings">Settings</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {campaignId === null ? (
          appName
        ) : (
          <CampaignTopBar campaignId={campaignId} fallback={appName} />
        )}
      </header>
      <main className="min-w-0">
        <Outlet />
      </main>
      <Notice />
    </div>
  );
}
