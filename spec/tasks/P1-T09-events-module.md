# P1-T09: Server events module: SSE bus and replay

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T02 |
| **Branch** | `p1-t09-events-module` |

## Goal

A small in-memory event bus per campaign with monotonically increasing IDs, a
bounded replay buffer, and SSE formatting. The HTTP route that streams it comes in
P1-T20.

## Read

- `spec/01-architecture.md` §6.2 (ARCH-090 to ARCH-092)
- `spec/03-contracts.md` §13, §14.2 (CON-113, CON-114)
- `spec/14-ui.md` UI-101, UI-132

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-090, ARCH-091, ARCH-092, CON-100, CON-114

## Outputs

- `apps/server/src/modules/events/`: `index.ts`, `bus.ts`, `sse.ts`, tests, `README.md`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other server modules

## Design notes

- `publish(campaignId, payload)` validates the payload with `ServerEventPayloadSchema`
  (a malformed event is a programmer error: throw), assigns the next ID, keeps it in
  the campaign's ring buffer (1,000 events), and delivers it to subscribers.
- **IDs** start at the server's start time in milliseconds and increase by one. After a
  restart every new ID is larger than any the client saw, so a stale `Last-Event-ID`
  is never mistaken for a current one.
- `subscribe(campaignId, lastEventId, send)`: if `lastEventId` is given and the buffer
  still holds the event after it, replay from there; if it is given but the gap is no
  longer covered, send `resync.required` first; with no `lastEventId`, send nothing
  old. Returns an unsubscribe function.
- `sse.ts` formats one event as an SSE frame (`id:`, `event:` with the payload type,
  `data:` with JSON) and a keep-alive comment (CON-114). The events module imports no
  other module (ARCH-021).

## Acceptance

- [x] ARCH-091: a subscriber reconnecting with a covered ID receives exactly the missed events in order; with an uncovered ID, `resync.required` then live events.
- [x] Two campaigns' events never reach each other's subscribers.
- [x] An invalid payload throws.
- [x] SSE frames match a fixed expected string, including a multi-line `data` value.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/events/`: `bus.ts` (`createEventBus`, `EventBus`,
    `SendEvent`, `REPLAY_BUFFER_SIZE`), `sse.ts` (`formatEvent`, `formatPosition`,
    `parseLastEventId`, `KEEP_ALIVE_COMMENT`, `KEEP_ALIVE_INTERVAL_MS`), `index.ts`,
    and `README.md`, with 16 tests in `bus.test.ts` and `sse.test.ts`. The module
    imports no other module and has no clock, timers, sockets, or logger. The README
    gives P1-T20 the route's steps in order.
  - Acceptance, by test:
    - ARCH-091: `a covered ID replays exactly the missed events in order, then live
      ones`, with another campaign's events in between, and `an evicted gap gets
      resync.required, then live events` after 1,001 publishes, which also shows that
      the evicted event's own ID is still covered;
    - ARCH-090: `two campaigns never receive each other’s events, live or replayed`;
    - ARCH-092: `publish throws on a payload the contract rejects, and sends nothing`
      (an unknown type, a missing field, a campaign ID that is not a UUID);
    - ARCH-090: `an event is one SSE frame` and `narration with line breaks stays on
      one data line and parses back unchanged`, each against a fixed string.
  - Mike's decision 1 by test: `a client that reconnects from the position it was
    given misses nothing`.
  - Verified, then reverted: making coverage `lastDroppedId < id` fails three tests,
    and dropping the upper bound fails the restart test.
  - `pnpm check` passes. The workspace has `Tests  216 passed (216)` and
    `spec/reference` `Tests  271 passed (271)`, and it ends with `Docs check passed: 834
    requirements, 25 tasks (6 done), 19 ADRs, 76 markdown files, 282 citations in code.`
- **Rulings:**
  - **Mike's decision 1: each stream starts at the current position**
    (`P1-T09: spec: owner: event streams per campaign, starting at the position`).
    With no `Last-Event-ID`, P1-T20 writes `formatPosition(bus.lastId())` first. An
    `id:` line with no `data:` sets the browser's last event ID without firing an
    event. Recorded in 01-architecture's Decisions.
  - **Mike's decision 2: ADR-001 says one stream per campaign a client has open**
    (`P1-T09: spec: owner: ADR-001 says one stream per open campaign`), not per client
    session, matching ARCH-090, with an Amended line. Also recorded in
    01-architecture's Decisions.
  - **Spec fix, ARCH-090:** 01-architecture's module table said "per-session replay
    buffer"; it now says per-campaign, as ARCH-090 and this task do.
  - **ARCH-091: IDs and coverage.** One ID counter per process; a `Last-Event-ID` is
    covered when `lastDroppedId <= id <= lastId()`; `resync.required` takes an ID of
    its own and is not buffered. Recorded in 01-architecture's Decisions.
  - **CON-114: the frame format.** `data` holds the whole `ServerEvent`, which P1-T21
    parses with `ServerEventSchema`, and the keep-alive is `: keep-alive`. Recorded in
    03-contracts' Decisions.
  - **The acceptance's "multi-line `data` value"** is read as narration text with line
    breaks, which JSON escapes onto one `data` line. Splitting it across several
    `data:` lines was rejected.
  - **An unreadable `Last-Event-ID` gives -1, not the plan's 0.** With `firstId` 1, 0 is
    the position before the first event, which is covered, so 0 could replay the whole
    buffer instead of resyncing. `createEventBus` throws a `RangeError` unless
    `firstId` is a positive safe integer, so every position is at least 0 and -1 is
    never covered. A header that arrives as an array is unreadable too.
  - **A rejected publish takes no ID**: the event is parsed before the counter moves.
  - **Subscribers are wrapped** as `{ send }`, so the same function subscribed twice is
    two subscribers. `send` may call its own unsubscribe function, and the Set skips
    a subscriber removed during delivery.
  - **Trap, 03-contracts (UI-101, UI-132):** every frame has an `event:` name, so
    `EventSource.onmessage` never fires; P1-T21 adds a listener per payload type.
  - **Open, 01-architecture:** streams have no back-pressure (with a suggestion for
    P1-T20: close a stream whose `writableLength` passes a limit, and let the client
    reconnect); replay buffers are never freed, even for a deleted campaign; and
    start-time IDs assume the previous process averaged under one event per
    millisecond.
- **Pending decisions:** None.
- **Not tested:** None. Every behavioral requirement has a test named by its ID.
- **Dependencies:** None.
