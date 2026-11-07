# http

The Fastify routes ([01-architecture.md §6.3](../../../../../spec/01-architecture.md)).
Each route parses its input with the contract schema, calls one module function, and maps
the result to a response; there is no game logic here (ARCH-023). It also holds the PIN
gate, the event stream, the error table, and the built client. It may import every other
module's public API (ARCH-021). The composition root (`app.ts`) builds everything it calls
and passes it in (ARCH-022).

## Public API (`index.ts`)

- `installHttp(fastify, deps)` installs everything on a Fastify instance the composition
  root made, in this order:
  1. the error handler;
  2. `@fastify/cookie`;
  3. the PIN gate;
  4. the routes;
  5. the built client and the not-found handler.

  It also adds a `preClose` hook that ends every open event stream at shutdown.

- `HttpDeps` (`deps.ts`) is what the routes call:
  - `config` (`current`, `save`), `auth`, `content`, and the event bus's `subscribe` and
    `lastId`;
  - `turn`: the turn module's `TurnDeps`, whose `store` the campaign, event, and
    inspector routes use too;
  - the providers' `probe` and `health`;
  - `listModels(providerId, signal)`, which the root builds from machine config and the
    adapter registry;
  - `clientDir`, and `setTimer` for the keep-alive.

## Routes

Exactly the routes of 03-contracts §14.2 and the phase-1 turn routes of 06-turn-engine
§11, all under `/api` (ARCH-100, CON-110). `index.test.ts` checks the list.

| File           | Routes                                                                                                                                        | Calls                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `session.ts`   | `GET`, `POST`, `DELETE /session`                                                                                                              | `auth.sessionState`, `login`, `logout`                                                                       |
| `library.ts`   | `GET /packs`, `GET /themes`                                                                                                                   | `content.listPacks`, `listThemes`                                                                            |
| `campaigns.ts` | `GET`, `POST /campaigns`; `GET`, `DELETE /campaigns/:campaignId`                                                                              | `listCampaignSummaries`, `createCampaign`, `campaignView`, `store.deleteCampaign`                            |
| `turns.ts`     | `POST /actions`, `POST /turns/:turnId/regenerate` and `/cancel`, `GET /turns/:turnId`, `GET /branches`, `GET /branches/:branchId/turns`       | `submitAction`, `regenerateStage`, `cancelTurn`, `turnView`, `branchViews`, `turnViews`                      |
| `events.ts`    | `GET /campaigns/:campaignId/events`                                                                                                           | `bus.subscribe`, `bus.lastId`                                                                                |
| `settings.ts`  | `GET`, `PUT /settings`; `PUT /settings/pin`; `GET /settings/providers` and `…/:providerId/models`; `POST /settings/profiles/:profileId/probe` | `config.current` with `redact`, `config.save`, `auth.setPin`, `health.statuses`, `listModels`, `probe.probe` |
| `inspector.ts` | `GET …/turns/:turnId/model-calls`, `GET …/model-calls/:callId`                                                                                | `listModelCalls` with `summaryOf`, `readModelCall`                                                           |

How a route answers:

- **Status.** A success with a body is `200`, and one without is `204`. An error's status
  comes from `STATUS_BY_CODE` (`errors.ts`), the one copy of ARCH-104's table.
- **Bodies and queries** are parsed with `parseRequest`. A failure is `validation_failed`
  with every issue at a dotted path (CON-091).
  - `PUT /settings` is the exception: its body goes to `config.save` unparsed, because
    placeholders get their stored secrets back before the schema runs (CON-111), and
    `save` then parses it.
- **Path parameters** are parsed with the schemas in `params.ts`. One that fails, such as
  a campaign ID that is no UUID, is `not_found`, since nothing can be at that address.
- **A body ID** that differs from the path's, such as `turnId` on `/cancel`, is
  `validation_failed` at that field (06-turn-engine §10).
- **Turn pages:** `?beforeDepth=&limit=` take decimal digits. `limit` runs from 1 to 200
  and defaults to 50 (`TURN_PAGE` in `turns.ts`).
- **Deleting a campaign** while one of its narrations runs is `turn_in_progress`, and
  deletes nothing (owner decision, 03-contracts Decisions).
- **Probe and model list:** both pass a signal that aborts if the client disconnects
  first.

## Errors (`errors.ts`)

- `sendError(reply, error)` sends `{ error: { code, message, details? } }` and nothing
  else, so a `ProviderError`'s `retryable` and `httpStatus` stay on the server (ARCH-101).
  A `rate_limited` error's `details.retryAfterSeconds` also goes in `Retry-After`.
- The error handler is the one place a throw is caught (CONV-041):
  - Fastify's own 4xx refusals, such as malformed JSON, an empty JSON body, or a body
    over the limit, are `validation_failed` with one issue at path `''`.
  - Anything else is logged with the request's ID and answered with `internal_error`. Its
    message is fixed, never the thrown one.

## The PIN gate (`session.ts`)

An `onRequest` hook builds the auth module's `AuthRequest` from the method, the matched
route pattern (`request.routeOptions.url`), the socket's address (never `request.ip`), the
headers, and the session cookie. On `ok(cookie)` it sets the cookie again, so its expiry
slides; on an error it replies `401 auth_required`. The auth module decides what is exempt
(CON-113): `GET` and `POST /session`, every pattern outside `/api`, and a request no route
matched. With the client served, an unknown `GET /api/…` matches the static `/*` pattern,
so it also passes, and the not-found handler answers it with `not_found`.

## The event stream (`events.ts`)

The route follows the events README's "Streaming a campaign":

1. It checks the campaign (`not_found` if there is none). Its body is a `PassThrough`, so
   Fastify sends the headers, the cookie among them, with the first frame. Frames written
   before Fastify starts piping wait in the stream, in order.
2. With no `Last-Event-ID` it writes `formatPosition(bus.lastId())`. Then it subscribes,
   and the bus replays from the ID or sends `resync.required`.
3. If nothing has been written by then, it writes the keep-alive at once, so the headers
   go out and the browser's `open` fires. After every write, the keep-alive waits 15
   seconds again (CON-114).
4. On the connection's `close` it unsubscribes and cancels the keep-alive.

A client more than `MAX_UNSENT_BYTES` (1 MiB) behind is closed, with a warning. Its
`EventSource` reconnects with its last event ID and is replayed or told to resync. At
shutdown, a `preClose` hook ends every open stream, so `close()` doesn't wait on them.

## The built client (`static.ts`)

`@fastify/static` serves `clientDir` from `/` (ARCH-102). The not-found handler answers
every request no route or file matched:

- **Under `/api`:** `not_found`.
- **Outside `/api`,** for a GET or HEAD whose last segment has no dot, such as `/new` or
  `/c/:campaignId/inspector/:turnId`: `index.html`, so the client's router opens that
  screen.
- **Anything else,** such as a missing `/assets/x.js` or a POST: `not_found`. A missing
  file never gets HTML.

With no `index.html` in `clientDir`, startup logs a warning, and every page answers
`not_found`, saying to run `pnpm build`. The API works as usual.

## Files

- **Production code:** `index.ts`, `deps.ts`, `errors.ts`, `params.ts`, `session.ts`,
  `library.ts`, `campaigns.ts`, `turns.ts`, `events.ts`, `settings.ts`, `inspector.ts`, and
  `static.ts`.
- **Test helpers** (not exported):
  - `testing.ts`. Its `createHttpSpace()` makes stacks of the real modules on fresh data
    directories. Each stack has one scriptable mock behind every model call, a movable
    time source, timers a test fires by hand, recorded logs, and the routes Fastify
    registered. `createArrival` and `settledTurn` create the reference campaign and wait
    for a turn.
  - `sse-testing.ts`. Its `frameReader` reads an SSE body frame by frame as it arrives.

## Rules for code here

- A route calls module public APIs only, and holds no game rule (ARCH-023). Anything
  that needs more than parsing and mapping belongs in a module, or in the composition
  root's wiring.
- Every error goes through `sendError`, so its status comes from the one table.
- Tests use `createHttpSpace()` and `await space.cleanUp()` after each test. That closes
  each server, which stops its narrations and queue, then closes its databases before
  the folders go (CONV-116). SSE tests read with `inject({ payloadAsStream: true })`,
  which resolves at the first frame. A test disconnects with `response.raw.res.destroy()`.

## Governing spec

- [01-architecture.md](../../../../../spec/01-architecture.md) §3 (ARCH-022, ARCH-023),
  §6.2 to §6.4, and its Traps, Decisions, and Open sections.
- [03-contracts.md](../../../../../spec/03-contracts.md) §12 (CON-091) and §14.2, and
  its Decisions.
- [06-turn-engine.md](../../../../../spec/06-turn-engine.md) §10 and the phase 1 row of
  §11.
- [02-conventions.md](../../../../../spec/02-conventions.md) §5, §6, and §9.
