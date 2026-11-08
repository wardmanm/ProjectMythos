import type { TurnStatus, TurnView } from '@mythos/contracts';

/**
 * Implements UI-054: the one quiet line under a turn while work is underway, and none
 * once it has finished or is waiting on the player. Phase 1 only narrates, so it only
 * ever shows "Writing…". A roll waiting on the player has its own card (UI-057).
 */
export const statusLine = {
  adjudicating: 'The GM is considering…',
  'awaiting-resolution': null,
  narrating: 'Writing…',
  extracting: 'Remembering…',
  'world-ticking': 'The world moves…',
  complete: null,
  'extraction-failed': null,
  'world-tick-failed': null,
  'stage-failed': null,
  abandoned: null,
} as const satisfies Record<TurnStatus, string | null>;

/**
 * Implements TRN-058 and UI-073: why the input dock can't send while the branch's head
 * has each status, or null for the three statuses that take a new action. An abandoned
 * turn is never the head the play screen sees; until the turns refetch, it is waiting.
 */
const waitingWhileHead = {
  adjudicating: 'The GM is considering…',
  'awaiting-resolution': 'Accept or change the roll first.',
  narrating: 'The GM is writing…',
  extracting: 'Remembering…',
  'world-ticking': 'The world moves…',
  complete: null,
  'extraction-failed': null,
  'world-tick-failed': null,
  'stage-failed': 'Retry or cancel the failed turn first.',
  abandoned: 'Opening the story…',
} as const satisfies Record<TurnStatus, string | null>;

export type InputAvailability = { available: true } | { available: false; reason: string };

/**
 * Whether the dock may send, and if not, the line that says why (UI-073). `head` is
 * null until the branch's turns load; `sending` is true from Send until the new turn is
 * on screen.
 */
export function inputAvailability(head: TurnView | null, sending: boolean): InputAvailability {
  if (sending) return { available: false, reason: 'Sending…' };
  if (head === null) return { available: false, reason: 'Opening the story…' };
  const status = head.turn.status;
  if (status === 'stage-failed' && head.turn.parentTurnId === null) {
    return { available: false, reason: 'Retry the opening first.' };
  }
  const reason = waitingWhileHead[status];
  return reason === null ? { available: true } : { available: false, reason };
}

/**
 * The branch's head as the play screen knows it: the last listed turn that isn't
 * abandoned. Abandoning a turn sends only its `turn.status` (06-turn-engine Open), so
 * the abandoned turn stays in the cached list until the list next refetches.
 */
export function headOf(turns: readonly TurnView[]): TurnView | null {
  return turns.findLast((view) => view.turn.status !== 'abandoned') ?? null;
}
