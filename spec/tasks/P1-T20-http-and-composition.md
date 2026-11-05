# P1-T20: HTTP routes and the composition root

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] Route tests with Fastify's `inject` cover every route in the table, a validation failure, a `not_found` route, and the PIN gate.
- [ ] CON-111: `GET /settings` never returns an inline secret; saving the response back unchanged keeps every secret.
- [ ] An end-to-end server test with the mock provider: create the reference campaign, receive the opening narration over SSE, submit an action, receive its narration.
- [ ] `pnpm build && pnpm start` serves the client and API on one port.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
