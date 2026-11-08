import type { TurnView } from '@mythos/contracts';
import { useEffect, useRef, useState } from 'react';
import { wholeSentences } from './sentences';

/** How many announced pieces stay in the region; screen readers read each as it is added. */
const KEPT = 20;

type Announcement = { id: number; text: string };

/**
 * The part of each turn's narration not yet announced: its new whole sentences while it
 * streams, and the rest once it is done. Updates `announced`, the length of each turn's
 * narration already announced. A turn seen for the first time is new if it is deeper
 * than every turn seen before; any other is history, which is never announced.
 */
export function newNarration(
  turns: readonly TurnView[],
  announced: Map<string, number>,
  deepestSeen: number,
): string[] {
  const pieces: string[] = [];
  for (const view of turns) {
    const text = view.narration?.text ?? '';
    const streaming = view.turn.status === 'narrating';
    if (!announced.has(view.turn.id)) {
      const isNew = view.turn.depth > deepestSeen || streaming;
      announced.set(view.turn.id, isNew ? 0 : text.length);
    }
    const from = Math.min(announced.get(view.turn.id) ?? 0, text.length);
    const upTo = streaming ? wholeSentences(text).length : text.length;
    if (upTo > from) {
      const piece = text.slice(from, upTo).trim();
      if (piece !== '') pieces.push(piece);
    }
    announced.set(view.turn.id, Math.max(from, upTo));
  }
  return pieces;
}

/**
 * Implements UI-112: new narration is announced through a polite live region, a whole
 * sentence at a time, never per token. The story itself has no live region, so what is
 * already on screen when the player arrives is not read out.
 */
export function NarrationAnnouncer({ turns }: { turns: readonly TurnView[] }) {
  const announced = useRef(new Map<string, number>());
  const deepestSeen = useRef<number | null>(null);
  const nextId = useRef(0);
  const [pieces, setPieces] = useState<Announcement[]>([]);

  useEffect(() => {
    if (turns.length === 0) return;
    // On first sight, everything already finished is history.
    const deepest = deepestSeen.current ?? Math.max(...turns.map((view) => view.turn.depth));
    const added = newNarration(turns, announced.current, deepest);
    deepestSeen.current = Math.max(deepest, ...turns.map((view) => view.turn.depth));
    if (added.length === 0) return;
    const fresh = added.map((text) => ({ id: nextId.current++, text }));
    setPieces((shown) => [...shown, ...fresh].slice(-KEPT));
  }, [turns]);

  return (
    <div role="status" aria-live="polite" aria-label="New narration" className="sr-only">
      {pieces.map((piece) => (
        <p key={piece.id}>{piece.text}</p>
      ))}
    </div>
  );
}
