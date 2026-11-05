# ADR-001: Server-Sent Events for server-to-client updates

- **Status:** Accepted
- **Date:** 2026-10-13
- **Amended:** 2026-11-05, wording only: one stream per campaign a client has open, not per
  client session, as ARCH-090 says (P1-T09)
- **Requirements:** ARCH-090, ARCH-091, ARCH-092, ARCH-100

## Context

The server has to push many things the client did not ask for at that moment:
narration tokens as they stream, rulings and roll results, job progress, extraction
finishing, off-screen news. Several tabs and devices (desktop, phone, tablet on the LAN)
may watch the same campaign. Everything the client sends is a discrete command: an
action, an accept, an edit.

## Decision

- One Server-Sent Events stream per campaign a client has open carries every
  server-to-client event for that campaign. Commands are ordinary HTTP `POST`, `PATCH`,
  and `DELETE` requests.
- Every event has a monotonically increasing ID. A reconnecting client sends
  `Last-Event-ID`; the server replays from a bounded buffer, or tells the client to
  refetch when the buffer no longer covers the gap.
- Event payloads are Zod schemas in `contracts`, parsed on the client like any other
  boundary input.

## Consequences

- It is plain HTTP. Fastify serves it without a plugin, the session cookie (ARCH-110)
  authenticates it with no second auth path, and `curl` can watch it.
- The browser's `EventSource` reconnects on its own and sends `Last-Event-ID`.
- Commands get normal status codes and error bodies (ARCH-101), and optimistic
  concurrency through `expectedHeadTurnId` (TRN-120).
- There are two channels to reason about: a command's response and the events it
  causes. Contracts define both, and the client applies events only to the TanStack
  Query cache (ARCH-120).
- Browsers limit HTTP/1.1 connections per origin to about six. One stream per tab is
  well within that for a single-player app.

## Alternatives considered

- **WebSockets.** Bidirectional, which this app does not need: the client never
  streams to the server. It would need a plugin, hand-built reconnection and replay,
  and its own authentication. Speech input (phase 10) uploads each recording as one
  request (`POST /transcribe`), so it does not change this.
- **Polling.** Too slow for token-by-token narration.

## Revisit when

A feature needs continuous upstream streaming. Add a WebSocket for that feature alone,
with its own ADR.
