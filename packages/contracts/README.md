# @mythos/contracts

The Zod schemas and the TypeScript types inferred from them, shared by every other
package. It depends on `zod` only and holds no logic beyond schema definitions and
trivial helpers ([01-architecture.md §2](../../spec/01-architecture.md)).

## Public API

- `@mythos/contracts`: the schemas and types in `src/index.ts`.
- `@mythos/contracts/content`: the content schemas in `src/content/index.ts`.

Both entry points export TypeScript source; there is no build step (ARCH-005). Both are
placeholders until P1-T02 copies the contracts in.

## Rules

`src/` is a byte-for-byte copy of `spec/reference/contracts/` (OVR-033). Never edit it
here: change the spec, then copy again. Prettier ignores `src/` for the same reason.

## Governing spec

- [03-contracts.md](../../spec/03-contracts.md)
- [04-content-schemas.md](../../spec/04-content-schemas.md)
