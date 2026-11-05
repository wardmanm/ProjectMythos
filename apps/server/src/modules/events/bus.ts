// The event bus behind each campaign's SSE stream (ARCH-090): it numbers events, keeps
// a bounded replay buffer per campaign, and replays missed events to a reconnecting
// client, or tells it to refetch when the buffer no longer covers the gap (ARCH-091).
import {
  type Id,
  type ServerEvent,
  type ServerEventPayload,
  ServerEventSchema,
} from '@mythos/contracts';

/** How many events each campaign keeps for replay (ARCH-091). */
export const REPLAY_BUFFER_SIZE = 1000;

/**
 * Delivers one event to one stream. It must not throw or publish: the bus catches
 * nothing, and a publish inside `send` would reach later subscribers out of order. It
 * may call its own unsubscribe function.
 */
export type SendEvent = (event: ServerEvent) => void;

/** One bus per server process, built by the composition root (ARCH-022). */
export type EventBus = {
  /** Checks, numbers, buffers, and delivers one event; see `publish` below. */
  publish(campaignId: Id, payload: ServerEventPayload): ServerEvent;
  /** Replays what a reconnecting stream missed, then delivers live events to it. */
  subscribe(campaignId: Id, lastEventId: number | null, send: SendEvent): () => void;
  /** The last ID issued, or `firstId - 1` if none has been. */
  lastId(): number;
};

export type EventBusOptions = {
  /**
   * The first event ID: the server's start time in milliseconds, so that after a
   * restart every new ID is larger than any a client saw (ARCH-091). The bus never
   * reads the clock itself (CONV-061).
   */
  firstId: number;
};

type Subscriber = { send: SendEvent };

/** A campaign's replay buffer and its open streams. */
type Channel = {
  /** The campaign's latest events, oldest first, at most `REPLAY_BUFFER_SIZE`. */
  events: ServerEvent[];
  /** The ID of the last event evicted from `events`, or `firstId - 1`. */
  lastDroppedId: number;
  // Wrapped, so the same function subscribed twice is two subscribers.
  subscribers: Set<Subscriber>;
};

/**
 * Creates the event bus. IDs come from one counter for the whole process, so a
 * campaign's IDs increase but can skip numbers. Implements ARCH-090 and ARCH-091.
 */
export function createEventBus(options: EventBusOptions): EventBus {
  const { firstId } = options;
  if (!Number.isSafeInteger(firstId) || firstId < 1) {
    throw new RangeError(`firstId must be a positive safe integer, got ${String(firstId)}`);
  }
  let lastIssuedId = firstId - 1;
  const channels = new Map<Id, Channel>();

  function channelFor(campaignId: Id): Channel {
    let channel = channels.get(campaignId);
    if (channel === undefined) {
      channel = { events: [], lastDroppedId: firstId - 1, subscribers: new Set() };
      channels.set(campaignId, channel);
    }
    return channel;
  }

  // Implements ARCH-092: a payload the contract rejects is a programmer error, so it
  // throws (CONV-041) before taking an ID. Parsing also drops unknown keys, so a
  // `state.changed` never carries state (CON-100).
  function nextEvent(campaignId: Id, payload: ServerEventPayload): ServerEvent {
    const event = ServerEventSchema.parse({ id: lastIssuedId + 1, campaignId, payload });
    lastIssuedId = event.id;
    return event;
  }

  // The buffer holds every event of the campaign after `lastDroppedId`, so a client
  // whose last ID is at least that misses nothing. An ID newer than any issued, or one
  // from before a restart, is not covered either.
  function isCovered(channel: Channel, lastEventId: number): boolean {
    return channel.lastDroppedId <= lastEventId && lastEventId <= lastIssuedId;
  }

  /**
   * Checks the payload against the contract (throwing if it fails), gives it the next
   * ID, keeps it in the campaign's buffer, and sends it to the campaign's subscribers.
   * Returns the event as sent.
   */
  function publish(campaignId: Id, payload: ServerEventPayload): ServerEvent {
    const event = nextEvent(campaignId, payload);
    const channel = channelFor(event.campaignId);
    channel.events.push(event);
    if (channel.events.length > REPLAY_BUFFER_SIZE) {
      const dropped = channel.events.shift();
      if (dropped !== undefined) channel.lastDroppedId = dropped.id;
    }
    for (const subscriber of channel.subscribers) subscriber.send(event);
    return event;
  }

  /**
   * With no `lastEventId`, sends nothing old. With a covered one, replays the buffered
   * events after it, in order; with any other, sends `resync.required`, which takes an
   * ID of its own and is not buffered. Replay happens before this returns.
   */
  function subscribe(campaignId: Id, lastEventId: number | null, send: SendEvent): () => void {
    const channel = channelFor(campaignId);
    if (lastEventId !== null) {
      if (isCovered(channel, lastEventId)) {
        for (const event of channel.events) if (event.id > lastEventId) send(event);
      } else {
        send(nextEvent(campaignId, { type: 'resync.required' }));
      }
    }
    const subscriber: Subscriber = { send };
    channel.subscribers.add(subscriber);
    return () => {
      channel.subscribers.delete(subscriber);
    };
  }

  return { publish, subscribe, lastId: () => lastIssuedId };
}
