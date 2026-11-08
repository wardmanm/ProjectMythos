import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** A reader this close to the end of the page, in CSS pixels, is at the bottom. */
const BOTTOM_SLACK = 64;

/** A reader this close to the top starts loading earlier turns. */
const NEAR_TOP = 400;

type StoryScrollOptions = {
  /** Changes whenever text is added at the end of the story: a new turn or new narration. */
  endKey: string;
  /** The oldest turn shown; it changes when earlier turns are added above. */
  firstTurnId: string | null;
  /** Called when the reader scrolls near the top. */
  onNearTop: () => void;
};

function pageHeight(): number {
  return document.documentElement.scrollHeight;
}

function isAtBottom(): boolean {
  return pageHeight() - window.scrollY - window.innerHeight <= BOTTOM_SLACK;
}

function scrollToEnd(): void {
  window.scrollTo({ top: pageHeight(), behavior: 'instant' });
}

/**
 * Where the story scrolls, by the page's own scroll position. Implements UI-053: new
 * text is followed only for a reader already at the bottom, and anyone else is offered
 * "New text below". Implements UI-043: when the viewport shrinks, as when a phone's
 * keyboard opens, or the page grows, as when the dock's text box gains a line, a reader
 * at the bottom stays there and anyone else keeps their place.
 * When earlier turns are added above, the page scrolls by their height, so the reader's
 * place doesn't move; the story sets `overflow-anchor: none` so the browser doesn't too.
 */
export function useStoryScroll({ endKey, firstTurnId, onNearTop }: StoryScrollOptions) {
  const atBottom = useRef(true);
  const lastHeight = useRef(0);
  const lastFirstTurnId = useRef(firstTurnId);
  const nearTop = useRef(onNearTop);
  const [newTextBelow, setNewTextBelow] = useState(false);

  useEffect(() => {
    nearTop.current = onNearTop;
  }, [onNearTop]);

  useEffect(() => {
    const onScroll = () => {
      atBottom.current = isAtBottom();
      if (atBottom.current) setNewTextBelow(false);
      if (window.scrollY < NEAR_TOP) nearTop.current();
    };
    const onResize = () => {
      if (atBottom.current) scrollToEnd();
    };
    // The page also grows without new text, as when the dock's text box gains a line.
    const pageSize = new ResizeObserver(onResize);
    pageSize.observe(document.body);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      pageSize.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);

  useLayoutEffect(() => {
    const height = pageHeight();
    const addedAbove = lastFirstTurnId.current !== null && firstTurnId !== lastFirstTurnId.current;
    if (addedAbove && !atBottom.current) {
      window.scrollTo({ top: window.scrollY + height - lastHeight.current, behavior: 'instant' });
    } else if (atBottom.current) {
      scrollToEnd();
    } else {
      setNewTextBelow(true);
    }
    lastFirstTurnId.current = firstTurnId;
    lastHeight.current = height;
  }, [endKey, firstTurnId]);

  const showNewText = useCallback(() => {
    scrollToEnd();
    atBottom.current = true;
    setNewTextBelow(false);
  }, []);

  return { newTextBelow, showNewText };
}
