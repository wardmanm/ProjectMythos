# @mythos/core

Pure game logic: dice and results, harm, clocks, world-state reducers, commit
validation, calendar math, retrieval scoring, and context budget allocation
([01-architecture.md §2.1](../../spec/01-architecture.md)). It depends on
`@mythos/contracts` only.

## Public API

`@mythos/core`, exported from `src/index.ts` as TypeScript source (ARCH-005). Empty
until P1-T03.

## Rules

Every function is deterministic given its inputs (ARCH-010). Code here never does IO,
never imports a Node built-in, and never calls `Date.now()`, `new Date()`, or
`Math.random()`: time and randomness are parameters (CONV-060). Lint enforces all of
this outside test files.

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §2
- [02-conventions.md](../../spec/02-conventions.md) §8
