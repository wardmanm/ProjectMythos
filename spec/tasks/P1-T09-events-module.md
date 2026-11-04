# P1-T09: Server events module: SSE bus and replay

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] ARCH-091: a subscriber reconnecting with a covered ID receives exactly the missed events in order; with an uncovered ID, `resync.required` then live events.
- [ ] Two campaigns' events never reach each other's subscribers.
- [ ] An invalid payload throws.
- [ ] SSE frames match a fixed expected string, including a multi-line `data` value.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
