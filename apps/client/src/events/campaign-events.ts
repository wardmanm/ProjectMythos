// The campaign's event stream (UI-101): one browser EventSource per open campaign. The
// only file that opens one (ARCH-120); the hook in use-campaign-events.ts applies what
// it reads to the query cache.
import { ServerEventSchema, type ServerEvent, type ServerEventPayload } from '@mythos/contracts';

/**
 * Every payload type. The server names each frame by its type (`event: turn.status`), and
 * an EventSource delivers a named frame only to a listener for that name (14-ui Traps).
 */
const eventTypes = {
  'turn.status': true,
  'turn.created': true,
  'resolution.ready': true,
  'narration.delta': true,
  'narration.done': true,
  'state.changed': true,
  'branch.changed': true,
  'job.updated': true,
  error: true,
  'resync.required': true,
} as const satisfies Record<ServerEventPayload['type'], true>;

/** Seconds to wait before reopening a stream the browser gave up on; the last repeats. */
export const reopenDelays = [1, 2, 5, 10, 30] as const;

export type CampaignEventsOptions = {
  campaignId: string;
  /** Each new event for this campaign, in order, never one already delivered. */
  onPayload: (payload: ServerEventPayload) => void;
  /** A reopened stream started fresh, so events while it was closed are lost: refetch. */
  onReopened: () => void;
};

/** What a frame that cannot be trusted becomes: the client refetches everything (UI-101). */
const resync: ServerEventPayload = { type: 'resync.required' };

/**
 * Opens the campaign's event stream and returns the function that closes it for good.
 *
 * The browser reconnects on its own after a dropped connection and resends
 * `Last-Event-ID`, so the server replays what was missed (ARCH-091). When the browser
 * gives up instead (an error status, such as `auth_required`), this reopens the stream
 * after each of `reopenDelays` in turn. Implements UI-132.
 */
export function openCampaignEvents(options: CampaignEventsOptions): () => void {
  const url = `/api/campaigns/${encodeURIComponent(options.campaignId)}/events`;
  let source: EventSource | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let lastId: number | null = null;
  let closed = false;

  const deliver = (frame: MessageEvent<unknown>): void => {
    const event = readFrame(frame.data, options.campaignId);
    if (event === null) {
      options.onPayload(resync);
      return;
    }
    // A replayed event the client already has changes nothing (UI-132).
    if (lastId !== null && event.id <= lastId) return;
    lastId = event.id;
    options.onPayload(event.payload);
  };

  const scheduleReopen = (): void => {
    const delay = reopenDelays[Math.min(attempt, reopenDelays.length - 1)] ?? 30;
    attempt += 1;
    reopenTimer = setTimeout(() => {
      reopenTimer = null;
      connect(true);
    }, delay * 1000);
  };

  const connect = (reopening: boolean): void => {
    const next = new EventSource(url);
    source = next;
    next.addEventListener('open', () => {
      attempt = 0;
      if (reopening) {
        // A fresh EventSource cannot send Last-Event-ID, so nothing missed is replayed.
        lastId = null;
        options.onReopened();
      }
    });
    for (const type of Object.keys(eventTypes)) {
      next.addEventListener(type, (frame) => {
        // The `error` payload shares its name with the EventSource's own connection error,
        // which is a plain Event. CLOSED means the browser will not reconnect by itself.
        if (frame instanceof MessageEvent) {
          deliver(frame);
        } else if (type === 'error' && next.readyState === EventSource.CLOSED && !closed) {
          scheduleReopen();
        }
      });
    }
  };

  connect(false);
  return () => {
    closed = true;
    if (reopenTimer !== null) clearTimeout(reopenTimer);
    source?.close();
  };
}

/** A frame's event, or null when it is not valid JSON, not a `ServerEvent`, or another campaign's. */
function readFrame(data: unknown, campaignId: string): ServerEvent | null {
  if (typeof data !== 'string') return null;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    // Unreadable: the caller treats it as a gap and refetches, so nothing is lost.
    return null;
  }
  const parsed = ServerEventSchema.safeParse(json);
  if (!parsed.success || parsed.data.campaignId !== campaignId) return null;
  return parsed.data;
}
