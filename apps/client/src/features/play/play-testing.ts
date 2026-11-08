// Test helpers for the play screen: turns on the test branch, parsed with the contract
// schema so they cannot drift from it, the answers that open a story, and a page that
// scrolls, which jsdom lacks.
import {
  TurnViewSchema,
  type ServerEventPayload,
  type TurnStatus,
  type TurnView,
} from '@mythos/contracts';
import { act } from '@testing-library/react';
import { onTestFinished, vi } from 'vitest';
import { latestEventSource } from '@/test/fake-event-source';
import { answer } from '@/test/fake-fetch';
import { branchId, campaignId, campaignView, serverEvent } from '@/test/fixtures';

/** The ID of the test branch's turn at `depth`. */
export function turnIdAt(depth: number): string {
  return `7a2d0c1f-4b63-4e8f-8b72-${depth.toString(16).padStart(12, '0')}`;
}

type TurnChanges = {
  status?: TurnStatus;
  input?: TurnView['input'];
  narration?: TurnView['narration'];
};

/**
 * The turn at `depth` as the server lists it: complete, with an in-character input after
 * the opening, and a finished narration.
 */
export function turnAt(depth: number, changes: TurnChanges = {}): TurnView {
  const input = depth === 0 ? null : { mode: 'ic', text: `I look around, ${String(depth)}.` };
  return TurnViewSchema.parse({
    turn: {
      id: turnIdAt(depth),
      parentTurnId: depth === 0 ? null : turnIdAt(depth - 1),
      depth,
      status: changes.status ?? 'complete',
      gameTimeStart: depth * 10,
      copiedFromTurnId: null,
      createdAt: '2026-11-05T10:00:00Z',
    },
    gameTimeLabel: 'Monday, October 12, 1874, evening',
    input: changes.input === undefined ? input : changes.input,
    ruling: null,
    visibleExplanation: null,
    draft: null,
    resolution: null,
    narration:
      changes.narration === undefined
        ? { text: `The fog thickens, ${String(depth)}.`, complete: true }
        : changes.narration,
    staleStages: [],
    failedStages: [],
    replayConflictCount: 0,
    offscreen: null,
    versionCounts: {},
    sharedWithOtherBranches: false,
    bookmarkNames: [],
  });
}

/** The turns from depth `from` to depth `to`, oldest first. */
export function turnsFrom(from: number, to: number): TurnView[] {
  return Array.from({ length: to - from + 1 }, (_, index) => turnAt(from + index));
}

/** `GET /branches/:branchId/turns` for the test branch, with its query string. */
export function turnsUrl(query: string): string {
  return `/api/campaigns/${campaignId}/branches/${branchId}/turns${query}`;
}

/** The address of a command on one of the test campaign's turns. */
export function turnUrl(turnId: string, command = ''): string {
  return `/api/campaigns/${campaignId}/turns/${turnId}${command}`;
}

/** Answers what opening the play screen asks for: the campaign, its newest turns, and its head. */
export function answerStory(turns: readonly TurnView[]): void {
  const head = turns.at(-1);
  if (head === undefined) throw new Error('a story has at least its opening');
  answer('GET', `/api/campaigns/${campaignId}`, {
    status: 200,
    body: campaignView({ headTurnId: head.turn.id }),
  });
  answer('GET', turnsUrl('?limit=50'), { status: 200, body: turns });
  answer('GET', turnUrl(head.turn.id), { status: 200, body: head });
}

/**
 * The server sends an event on the campaign's stream. The query cache tells the screen
 * on a timer, so this waits for that before the test looks.
 */
export async function sendEvent(payload: ServerEventPayload): Promise<void> {
  await act(async () => {
    latestEventSource().send(serverEvent(payload));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export type FakePage = {
  /** The page's scroll position, `window.scrollY`. */
  readonly top: number;
  /** The reader scrolls to `top`. */
  scrollTo: (top: number) => void;
  /** The page's content becomes `px` tall, as when text is added. */
  setHeight: (px: number) => void;
  /** The viewport becomes `px` tall, as when a phone's keyboard opens. */
  resize: (px: number) => void;
};

/**
 * A page `height` tall in a viewport `viewport` tall, scrolled to the top. Scrolling
 * moves `window.scrollY` and fires `scroll`, as a browser does; resizing fires `resize`.
 */
export function fakePage({ height, viewport }: { height: number; viewport: number }): FakePage {
  const page = { height, viewport, top: 0 };
  const root = document.documentElement;
  Object.defineProperty(root, 'scrollHeight', { configurable: true, get: () => page.height });
  onTestFinished(() => {
    Reflect.deleteProperty(root, 'scrollHeight');
  });
  const moveTo = (top: number) => {
    const clamped = Math.max(0, Math.min(top, page.height - page.viewport));
    if (clamped === page.top) return;
    page.top = clamped;
    vi.stubGlobal('scrollY', clamped);
    window.dispatchEvent(new Event('scroll'));
  };
  vi.stubGlobal('innerHeight', viewport);
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('scrollTo', (options: ScrollToOptions) => {
    moveTo(options.top ?? page.top);
  });
  return {
    get top() {
      return page.top;
    },
    scrollTo: moveTo,
    setHeight: (px) => {
      page.height = px;
    },
    resize: (px) => {
      page.viewport = px;
      vi.stubGlobal('innerHeight', px);
      window.dispatchEvent(new Event('resize'));
    },
  };
}
