# P1-T20: HTTP routes and the composition root

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T11, P1-T12, P1-T15, P1-T16, P1-T19 |
| **Branch** | `p1-t20-http-and-composition` |

## Goal

Wire everything together: construct every module in one place, expose the phase-1
routes, stream events, apply the PIN, map errors, and serve the built client.

## Read

- `spec/01-architecture.md` §1 (ARCH-006, ARCH-007), §3 (ARCH-022, ARCH-023), §6.3, §6.4
- `spec/03-contracts.md` §12 (CON-091), §14.2 (all routes and CON-110 to CON-114)
- `spec/09-context.md` §10 (CTX-110)
- `spec/06-turn-engine.md` §10 and the phase 1 row of §11
- `spec/02-conventions.md` §5, §6, §9

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-006, ARCH-007, ARCH-022, ARCH-042, ARCH-023, ARCH-100, ARCH-101, ARCH-102, ARCH-103, ARCH-104, ARCH-110, CON-091, CON-110, CON-111, CON-112, CON-113, CON-114, CONV-030, CONV-041, CONV-071, CTX-110, PRV-003, PRV-004

## Outputs

- `apps/server/src/app.ts` (composition root) and `apps/server/src/main.ts` (CLI entry: `--data-dir`, `--port`)
- `apps/server/src/cli/rebuild-projections.ts` with a `rebuild-projections` script in `apps/server/package.json` (ARCH-007, ARCH-042)
- `apps/server/src/modules/http/`: `index.ts`, one route file per area (`session.ts`, `library.ts`, `campaigns.ts`, `turns.ts`, `events.ts`, `settings.ts`, `inspector.ts`), `errors.ts`, `static.ts`, tests, `README.md`
- Root `package.json` scripts `dev`, `build`, `start` implemented (ARCH-006), with `scripts/dev.ts`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`
- Module internals other than `http` (use public APIs)

## Design notes

- **Routes.** Exactly those in 03-contracts §14.2 plus the phase-1 turn routes listed in
  06-turn-engine §11. Anything else returns `not_found` (CON-110).
- Each handler parses its input with the contract schema, calls one module function,
  and maps the result (ARCH-023). Validation failures return `validation_failed` with
  `details: { issues }` (CON-091), converting Zod issues to dotted paths; errors map to statuses with ARCH-104's table, in
  `errors.ts`. Unexpected throws are caught once, logged, and returned as
  `internal_error` (CONV-041).
- **Events route** writes SSE frames from the events module, honors `Last-Event-ID`,
  sends keep-alives every 15 seconds (CON-114), and unsubscribes on close.
- **PIN gate** as a Fastify `onRequest` hook using the auth module; exempt routes per
  CON-113. A `401` carries `auth_required`.
- **Static client** from `apps/client/dist` with fallback to `index.html` for client
  routes (ARCH-102).
- **Composition root** (ARCH-022): build config, storage, events, auth, content,
  providers (registry with all four adapters, queue, pipeline), context (with its
  `ContextDependencies` built from config and the providers' role routing and
  calibration, CTX-110), turn, and http in dependency order, with a real `TimeSource` and
  `Rng`. Shut down cleanly on SIGINT and SIGTERM: stop accepting
  requests, cancel interactive jobs, close databases.
- `scripts/dev.ts` runs the server with `tsx watch` and Vite's dev server (whose `/api`
  proxy P1-T21 configures) without importing either app (ARCH-007).

## Acceptance

- [x] Route tests with Fastify's `inject` cover every route in the table, a validation failure, a `not_found` route, and the PIN gate.
- [x] CON-111: `GET /settings` never returns an inline secret; saving the response back unchanged keeps every secret.
- [x] An end-to-end server test with the mock provider: create the reference campaign, receive the opening narration over SSE, submit an action, receive its narration.
- [x] `pnpm build && pnpm start` serves the client and API on one port.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/app.ts`, the composition root (ARCH-022):
    - `createServer`: machine config, then Fastify and its pino logger, then every
      module in dependency order. It recovers interrupted turns (TRN-012) and resumes
      the queue before installing the http module, and adds the shutdown hooks.
    - `listenAddress` (ARCH-103), `contextDependencies` (CTX-110), and
      `openCampaignTools` for the CLI.
  - `apps/server/src/main.ts`: `--data-dir` and `--port`, listen, and shutdown on
    SIGINT and SIGTERM.
  - `apps/server/src/cli/rebuild-projections.ts`: every campaign, or the IDs given
    (ARCH-007, ARCH-042). Its script is `rebuild-projections` in
    `apps/server/package.json`.
  - `apps/server/src/modules/http/`:
    - `index.ts` (`installHttp`), `deps.ts`, `errors.ts`, and `params.ts`;
    - one route file per area: `session.ts` (with the PIN gate), `library.ts`,
      `campaigns.ts`, `turns.ts`, `events.ts`, `settings.ts`, and `inspector.ts`;
    - `static.ts`, for the built client and the not-found handler;
    - the test helpers `testing.ts` and `sse-testing.ts`, and `README.md`.
  - `scripts/dev.ts`. The root `dev` and `start` scripts, and the server's `dev`,
    `start`, and `rebuild-projections` scripts.
  - READMEs: http (new), the server, scripts, and the root's command table.
  - 74 new tests:
    - in http: `errors.test.ts` (8), `index.test.ts` (2), `session.test.ts` (7),
      `library.test.ts` (2), `campaigns.test.ts` (6), `turns.test.ts` (8),
      `events.test.ts` (9), `settings.test.ts` (10), `inspector.test.ts` (4), and
      `static.test.ts` (4);
    - `app.test.ts` (8), `cli/rebuild-projections.test.ts` (3), and
      `scripts/dev.test.ts` (3).
  - Acceptance, by test (the checklist is ticked):
    - every route: `CON-110, ARCH-100: the server has exactly the routes the spec
      lists, all under /api`, and each route file's tests, through `inject`;
    - a validation failure: `ARCH-023, CON-091: a command the contract rejects lists
      every issue at its path`;
    - `not_found`: `CON-110: an unlisted /api route, or a listed one with another
      method, is not_found`;
    - the PIN gate: `CON-113, ARCH-110: with a PIN and no session, only GET and POST
      /session pass`, and the session tests after it;
    - CON-111: `GET /settings never holds an inline secret or the PIN hash`, and
      `saving the response back unchanged keeps every secret`;
    - end to end: `ARCH-022: with the mock provider, the opening and an action narrate
      over SSE end to end`.
  - By hand, on macOS:
    - `pnpm build && pnpm start --data-dir <tmp> --port 5392` served `/` and `/c/abc`
      as `index.html`, an asset as `font/woff2`, `/api/session`, and `/api/nope` as a
      404 `not_found`, all on one port. A SIGINT to its process group logged "shutting
      down" and "stopped", and every process exited.
    - `pnpm dev --data-dir <tmp>`: Vite served the page on 5173, and `/api/session` and
      `/api/packs` answered through its proxy. Ctrl+C stopped every process without a
      force kill.
    - `rebuild-projections` reported an empty data directory, and an unknown campaign
      failed with exit code 1.
  - `pnpm check` passes on the branch, whose base is `main` at d0462e8. The workspace
    has `Tests  1136 passed (1136)` and `spec/reference` has `Tests  273 passed (273)`.
    It ends with `Docs check passed: 835 requirements, 25 tasks (21 done), 21 ADRs, 87
    markdown files, 1490 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, while planning, 2026-11-07):
    - `DELETE /campaigns/:campaignId` while a narration of the campaign runs is
      `turn_in_progress`, and deletes nothing (03-contracts Decisions, with a test).
    - Logs go to stdout only in phase 1; `<dataDir>/logs/` is an 01-architecture Open
      item (01-architecture Decisions).
  - **01-architecture, Claude (ruling):**
    - Decisions:
      - a request no route matched gets `index.html` only for a GET or HEAD outside
        `/api` whose last segment has no dot (ARCH-102, CON-110);
      - a stream more than 1 MiB behind is closed. This replaces the Open item on
        back-pressure, whose suggestion was meant for this task;
      - a stream with nothing to send at first gets the keep-alive at once;
      - the shutdown order.
    - Traps: Fastify sends a stream's headers with its first chunk; a second signal
      kills the server mid-shutdown under `tsx watch`.
    - Open: the session cookie is never `Secure` until phase 10 brings HTTPS.
  - **03-contracts Decisions, Claude (ruling):** `200` with a body and `204` without; a
    path parameter that fails its schema is `not_found`; Fastify's own refusals are
    `validation_failed` at `''`, and any other throw is `internal_error` with a fixed
    message; `PUT /settings`'s body is parsed by config's `save`, not by the route.
  - **06-turn-engine Decisions, Claude (ruling):** the turn page query (decimal
    digits, `limit` from 1 to 200, default 50), and a body `turnId` that differs from
    the path's is `validation_failed` at `turnId`.
  - **05-providers Open:** a ComfyUI provider's model list is `internal_error` until
    phase 9.
  - **Extra files** (CONV-132):
    - `http/deps.ts` and `http/params.ts`, which keep each route file to its routes;
    - `http/testing.ts` and `http/sse-testing.ts`, the route tests' harness, split
      to keep each under 300 lines;
    - the root `README.md`, `scripts/README.md`, and `apps/server/README.md`.
  - **Smaller calls:**
    - **No `Rng`.** The composition root builds none: no phase-1 module takes one, and
      `contracts` has no `Rng` type yet. It arrives with dice in phase 3.
    - **`listModels` is built in `app.ts`** from machine config and the adapter
      registry, so the models route calls one function (ARCH-023). An unknown provider
      is `not_found`.
    - **The model call summary.** `summaryOf` in http builds `ModelCallSummary` from
      the stored record, as the schema's comments say: the time of every attempt
      together, and the tokens of the last.
    - **While machine config fails to load:** nothing is pruned
      (`modelCallRecordDays` is null), the context section is the schema's defaults,
      and the server listens at the schema's `0.0.0.0:5317`.
    - **`profileFor` ignores the campaign** until PRV-006 arrives in phase 3, as
      `routeRole` does.
    - **Signals.** `main.ts` exits at once on a second signal. pnpm passes a leading
      `--` through to a script, so `main.ts` and the CLI drop it.
    - **SSE in tests.** The SSE tests read with `inject({ payloadAsStream: true })`,
      which resolves at the first frame, so no test opens a socket (CONV-113).
- **Pending decisions:** None.
- **Not tested:** None.
- **Dependencies:** `fastify` 5.12.8, `@fastify/static` 10.1.10, `@fastify/cookie`
  11.1.5, and `tsx` 4.23.15 as a runtime dependency of the server (ADR-015). All four
  are on CONV-091's list, so no ADR is needed. `pnpm-workspace.yaml` is unchanged.
