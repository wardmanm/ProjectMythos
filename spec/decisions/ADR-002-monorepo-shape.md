# ADR-002: A four-package pnpm monorepo with source-only shared packages

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** ARCH-001, ARCH-003, ARCH-004, ARCH-005, ARCH-010, ARCH-021

## Context

The code has three kinds of logic with different rules: pure game logic that must be
deterministic and easy to test; server code that does IO; and a browser client that
must never hold game rules. Data shapes are shared by all three. The project must stay
small enough for one person to understand.

## Decision

- A pnpm workspace with `apps/server`, `apps/client`, `packages/contracts`, and
  `packages/core`, named `@mythos/server`, `@mythos/client`, `@mythos/contracts`, and
  `@mythos/core`. `spec/reference` is also a workspace member so its checks run in
  `pnpm check` (ADR-016).
- Dependency direction is fixed (ARCH §2) and enforced by `eslint-plugin-boundaries`:
  `core` depends only on `contracts`; the client depends only on `contracts`.
- `contracts` and `core` have no build step. Their `exports` point at `src/index.ts`,
  and every consumer compiles them as source (ADR-015).
- Growth happens inside modules. A new package or app needs an ADR (ARCH-003).

## Consequences

- The purity of `core` is structural: it cannot import Node APIs, the server, or the
  client, so its tests need no mocks.
- The client cannot accidentally ship game rules or provider calls.
- No `dist` folders, no build ordering, no stale builds of shared packages.
- Four packages are a little more ceremony than one.

## Alternatives considered

- **One package.** Simplest, but nothing stops the client importing server code or
  `core` reading the clock.
- **A package per server module.** Real boundaries, but a dozen `package.json` files
  for a single-player app. Module boundaries inside the server are enforced by lint
  instead (ARCH-020, ARCH-021).
- **Nx or Turborepo.** Useful for large build graphs; this one has no build graph.
