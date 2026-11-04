# Mythos

A single-player, AI-run tabletop roleplaying game that runs locally in a browser. A
language model acts as the GM; TypeScript code owns rules, state, time, and memory.

The specification in [`spec/`](spec/00-overview.md) describes what Mythos must do and is
the only description of each topic. [`CLAUDE.md`](CLAUDE.md) describes how it is built,
one task at a time.

## Prerequisites

- Node.js 26.11.0 or later in the 26 line (`.nvmrc` says `26`; with nvm, run `nvm use`).
- pnpm through Corepack, which no longer ships with Node 26: `npm install -g corepack`,
  then `corepack enable`. Corepack installs the pnpm version pinned in `package.json`.

## Commands

| Command        | Does                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| `pnpm install` | Installs the workspace                                                  |
| `pnpm check`   | Typecheck, lint, format check, and all tests: the definition of passing |
| `pnpm test`    | All tests; `pnpm --filter @mythos/core test` for one package            |
| `pnpm lint`    | ESLint, including the package and module boundaries                     |
| `pnpm format`  | Formats every file Prettier owns                                        |
| `pnpm build`   | Builds the client                                                       |
| `pnpm dev`     | Server and client together (from P1-T20)                                |

## Repository map

```
apps/server         Fastify server: modules under src/modules/<name>/
apps/client         React + Vite client
packages/contracts  Zod schemas, copied from the spec
packages/core       Pure game logic
scripts             Cross-platform Node scripts
spec                The specification, fixtures, reference code, phases, and tasks
```

## License

[MIT](LICENSE)
