# ADR-015: TypeScript 6.0, run with tsx, no build step

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** ARCH-005, ARCH-006, CONV-091, CONV-121

## Context

TypeScript 7.0, the native compiler, was released in July 2026. As of October 2026,
`typescript-eslint`, which CONV-121 requires, supports TypeScript versions below 6.1.
The server must run TypeScript, and the shared packages are consumed as source
(ADR-002).

Node 26 can strip types natively, but it resolves imports like JavaScript: relative
imports need explicit `.ts` extensions, and it ignores `tsconfig` path settings. The
contracts use extensionless relative imports, as the spec shows them.

## Decision

- Pin TypeScript 6.0 (`~6.0.3`) and `typecheck` with `tsc --noEmit`.
- Run the server with `tsx`: `tsx watch` in development and `tsx` in production. There
  is no server build step.
- Vite builds the client. Vitest runs all tests.

## Consequences

- No `dist` folders, no build ordering, and no source maps to configure for the
  server.
- `tsx` is a runtime dependency (it bundles `esbuild`). Startup transpiles on the fly,
  which takes well under a second for a project this size.
- Moving to TypeScript 7 is a later ADR, once `typescript-eslint` supports it.

## Alternatives considered

- **TypeScript 7 now.** Faster typechecks, but no supported lint integration.
- **Compile the server with `tsc` or a bundler.** A build step for no runtime benefit
  in a local app.
- **Node's native type stripping.** Would require `.ts` extensions on every import and
  give up path mapping; worth revisiting once the codebase is stable.
