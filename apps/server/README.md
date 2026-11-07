# @mythos/server

The Fastify server: every piece of game logic that touches IO, the job queue, and the
HTTP API. It runs TypeScript directly with `tsx`; there is no build step (ADR-015).
Nothing imports it.

## Layout

- `src/main.ts`: the entry point. It reads `--data-dir` and `--port`, builds the server,
  listens, and shuts down cleanly on SIGINT or SIGTERM; a second signal exits at once.
- `src/app.ts`: the composition root, the only place modules are constructed and wired
  together (ARCH-022). It exports:
  - `createServer(options)`: every module in dependency order, with the real wall time
    and `crypto.randomUUID`, and the http module on top. It returns
    `{ fastify, dataDir, listen, close }`. Tests pass `logger: false`, `clientDir: null`,
    and a fixed `timeSource`.
  - `listenAddress(config, portFlag)`: machine config's host and port, with `--port` over
    the port, or the schema's defaults (`0.0.0.0:5317`) while the config fails to load
    (ARCH-103).
  - `contextDependencies(...)`: what the context module gets instead of `config` and
    `providers` (CTX-110).
  - `openCampaignTools(options)`: the campaign store alone, for the command-line tools.
- `src/modules/<name>/`: one folder per module, each with a single public `index.ts`
  and its own `README.md` (ARCH-020, CONV-023). Modules import each other only as the
  table in [01-architecture.md §3](../../spec/01-architecture.md) allows (ARCH-021).
- `src/cli/`: command-line tools, which get their modules from `app.ts` and import
  nothing else from the server (ARCH-007, ARCH-022). There is one so far:
  `rebuild-projections.ts`.
- `test/fixtures/model/`: the mock provider's recorded fixtures (PRV-081), described in
  [its README](test/fixtures/model/README.md).

Lint enforces these boundaries.

## Running it

| Script                                   | Does                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pnpm start` (root)                      | `tsx src/main.ts`: the API and the built client on one port (ARCH-102)                   |
| `pnpm dev` (root)                        | `scripts/dev.ts`: this package's `dev` (`tsx watch src/main.ts`) and the client's Vite   |
| `pnpm --filter @mythos/server rebuild-projections` | Rebuilds every campaign's projections from its event log (ARCH-042)             |

- **Flags:** `pnpm start --data-dir <folder> --port <number>` passes both to
  `main.ts`, and `pnpm dev` passes its arguments to the server. Without `--data-dir`,
  the data directory is machine config's, else the OS default (ARCH-030). Without
  `--port`, the port is machine config's, 5317 by default, which is where Vite's `/api`
  proxy points.
- **`rebuild-projections`** takes `--data-dir` and, optionally, campaign IDs; with none
  it rebuilds every campaign. Each rebuild is one transaction.
- **At start,** before any request, turns a shutdown left mid-narration become
  `stage-failed` (TRN-012), and the queue takes back its stored jobs (PRV-062).
- **On `close()`:**
  1. Fastify refuses new requests.
  2. The event streams end.
  3. Narrations stop and commit the text they have (06-turn-engine Decisions).
  4. The queue stops, cancelling interactive jobs.
  5. In-flight requests finish.
  6. Every database closes.
- **Logs** are pino's JSON on stdout. Nothing is written to `<dataDir>/logs/` yet
  (01-architecture Open).

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §3 to §6
- [02-conventions.md](../../spec/02-conventions.md)
