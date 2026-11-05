import { MenuIcon } from 'lucide-react';
import { Link, Outlet } from 'react-router';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The layout every screen sits in: a top bar with the menu and the app's name, then the
 * screen, then the notice line. Phone first: nothing has a fixed width, and the content
 * area may shrink below its children's widths, so no screen scrolls sideways (UI-042).
 * Every control is a 44 px target reachable with Tab (UI-110, CONV-103).
 */
export function AppShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background font-interface text-text">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-2">
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
        <Link
          to="/"
          className="inline-flex min-h-11 items-center rounded-md px-2 font-display text-lg text-text"
        >
          Mythos
        </Link>
      </header>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
      <Notice />
    </div>
  );
}
