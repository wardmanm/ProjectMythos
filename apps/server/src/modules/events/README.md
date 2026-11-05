# events

The event bus behind each campaign's Server-Sent Events stream, and the SSE wire format.
Modules publish events for a campaign; each open stream subscribes to its campaign. The
bus numbers every event, keeps the last 1,000 of each campaign for replay, and replays
what a reconnecting client missed, or tells it to refetch. It imports no other module
(ARCH-021), and has no clock, timers, sockets, or logger: the route that streams it is
in `http`.

## Public API (`index.ts`)

- `createEventBus({ firstId })` builds the one bus for the process. The composition
  root (ARCH-022) passes the server's start time in milliseconds as `firstId`, so after
  a restart every new ID is larger than any a client saw. `firstId` must be a positive
  safe integer.
- `EventBus`:
  - `publish(campaignId, payload)` checks the event against `ServerEventSchema`, gives
    it the next ID, buffers it, sends it to the campaign's subscribers, and returns it.
    A payload the contract rejects throws a `ZodError` (ARCH-092): that is a programmer
    error. Unknown keys are dropped, so a `state.changed` never carries state (CON-100).
    `publish` can be handed to another module as a plain function.
  - `subscribe(campaignId, lastEventId, send)` returns an unsubscribe function. With
    `lastEventId` null it sends nothing old. With an ID the buffer covers, it replays
    the events after it, in order. With any other ID (from before a restart, newer than
    any issued, or older than the buffer) it sends `resync.required`, which takes an ID
    of its own and is not buffered. Either way, live events follow.
  - `lastId()` is the last ID issued in any campaign, or `firstId - 1` if none has been.
- `REPLAY_BUFFER_SIZE` is 1,000 events per campaign.
- `formatEvent(event)` gives one frame: `id:`, `event:` with the payload type, and
  `data:` with the whole `ServerEvent` as JSON on one line, which the client parses
  with `ServerEventSchema`.
- `formatPosition(id)` gives a frame with only `id:`. It sets the browser's last event
  ID without firing an event.
- `parseLastEventId(header)` reads the `Last-Event-ID` header: null when missing or
  empty, the number for a decimal safe integer, and -1, which nothing covers, for
  anything else.
- `KEEP_ALIVE_COMMENT` and `KEEP_ALIVE_INTERVAL_MS` (15 seconds) are the idle keep-alive
  (CON-114).

## Streaming a campaign

The route in `http` does this, in order:

1. Write the response headers (`Content-Type: text/event-stream`), because `subscribe`
   replays synchronously, before it returns.
2. With no `Last-Event-ID`, write `formatPosition(bus.lastId())`. A client that drops
   before its first event then reconnects from here and misses nothing.
3. Call `subscribe(campaignId, parseLastEventId(header), send)`, where `send` writes
   `formatEvent(event)` to the response.
4. Write `KEEP_ALIVE_COMMENT` whenever the stream has been idle for
   `KEEP_ALIVE_INTERVAL_MS`.
5. Call the unsubscribe function when the connection closes.

`send` runs inside `publish`, so it must not throw or publish: the bus catches nothing,
and a publish inside `send` would reach later subscribers out of order. It may call
its own unsubscribe function. The bus has no back-pressure: a slow client's frames wait
in Node's socket buffer (01-architecture, Open).

## Files

- `bus.ts`: `createEventBus`, the IDs, the per-campaign buffer, and replay.
- `sse.ts`: the frames, the keep-alive, and `parseLastEventId`.

## Governing spec

- [01-architecture.md](../../../../../spec/01-architecture.md) §6.2: ARCH-090 to
  ARCH-092.
- [03-contracts.md](../../../../../spec/03-contracts.md) §13 (the events and CON-100) and
  §14.2 (the stream's route and CON-114).
- [ADR-001](../../../../../spec/decisions/ADR-001-sse-for-server-events.md): why SSE.
