# scripts

Repository tooling, written as Node scripts in TypeScript so it behaves the same on
Windows and macOS (CONV-081). There are no shell scripts.

## Contents

- `check-spec.ts`: the spec check, run by `pnpm check`. It fails if `content-library/` or
  `content-packs/reference/` is missing a fixture file or differs from it by a byte
  (OVR-030), or if `packages/contracts/src/` and `spec/reference/contracts/` do not hold
  the same files with the same bytes (OVR-033). It also compares each server type file
  copied whole, listed in `serverTypeCopies` as `<module>/<file>`, with
  `spec/reference/server-types/<module>/<file>` (OVR-033). A file that adds an
  implementation after its verbatim types is not listed. Each message names the file.
  Its test, `check-spec.test.ts`, runs it on small fake repositories.
- `dev.ts`: `pnpm dev` (ARCH-006). It runs `pnpm --filter @mythos/server run dev`
  (`tsx watch`) and `pnpm --filter @mythos/client run dev` (Vite, whose `/api` proxy
  reaches the server) with no shell, and passes its arguments to the server.
  - pnpm comes from `npm_execpath`: run with Node if it is a script, or as itself if it
    is pnpm's own binary.
  - Ctrl+C reaches both processes from the terminal, so the script only waits for them.
    When one ends by itself, it stops the other. Signal a process once: a second
    signal makes `tsx watch` kill the server mid-shutdown.
  - Its test, `dev.test.ts`, checks the commands it builds and the `dev`, `build`, and
    `start` scripts.
- `lint-rules.test.ts`: proves that each boundary and restriction in `eslint.config.js`
  fires. It lints small code strings under fake file paths in a throwaway copy of the
  repository layout, so a change to the lint config that weakens a rule fails the tests.

## Rules

- Scripts import no app code from `apps/` (ARCH-007); lint enforces it. Command-line
  tools that need server modules live in `apps/server/src/cli/` instead.
- Build paths with `node:path` (CONV-080) and put temporary files in `os.tmpdir()`
  (CONV-085).
- `console` is allowed here, because the output is for a person at a terminal (CONV-070).

## Governing spec

- [01-architecture.md](../spec/01-architecture.md) §1
- [02-conventions.md](../spec/02-conventions.md) §10 and §14
