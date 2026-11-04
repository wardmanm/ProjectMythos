# ADR-003: Hand-written SQL, no ORM

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** CONV-050, CONV-051, CONV-052, ARCH-050

## Context

Storage is an append-only commit log plus projections, every projection query is
scoped to a branch through `branch_turns`, and each campaign is its own SQLite file
opened at runtime. The owner knows SQL well and wants to read every query.

## Decision

- SQL is written by hand in repository files inside the `storage` module and the
  repositories it exposes to other modules.
- Migrations are numbered `.sql` files, forward-only, applied by a small in-repo
  runner when a campaign opens. Applied migrations are never edited.
- Every row read is parsed with a Zod row schema before use.

## Consequences

- Every query is visible in review, including the branch-scoping joins that matter
  most for knowledge boundaries.
- No code generation and no ORM migration diffing near an event log.
- More boilerplate: row schemas and SQL columns are maintained side by side. Storage
  tests against a real temporary database (CONV-116) catch mismatches.

## Alternatives considered

- **Drizzle or Kysely.** Typed queries, but another layer for agents and the owner to
  learn, and the branch-scoping joins would still be hand-shaped.
- **Prisma.** Code generation, a schema language, and a poor fit for many SQLite files
  opened dynamically.
