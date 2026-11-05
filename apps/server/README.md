# @mythos/server

The Fastify server: every piece of game logic that touches IO, the job queue, and the
HTTP API. It runs TypeScript directly with `tsx`; there is no build step (ADR-015).
Nothing imports it.

## Layout

- `src/main.ts`: the entry point. A placeholder until P1-T20.
- `src/app.ts`: the composition root, the only place modules are constructed and wired
  together (ARCH-022). Arrives with P1-T20.
- `src/modules/<name>/`: one folder per module, each with a single public `index.ts`
  and its own `README.md` (ARCH-020, CONV-023). Modules import each other only as the
  table in [01-architecture.md §3](../../spec/01-architecture.md) allows (ARCH-021).
- `src/cli/`: command-line tools, which get their modules from `app.ts` and import
  nothing else from the server (ARCH-007, ARCH-022).
- `test/fixtures/model/`: the mock provider's recorded fixtures (PRV-081), described in
  [its README](test/fixtures/model/README.md).

Lint enforces these boundaries.

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §3 to §6
- [02-conventions.md](../../spec/02-conventions.md)
