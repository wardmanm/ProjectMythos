# @mythos/contracts

The Zod schemas and the TypeScript types inferred from them, shared by every other
package. It depends on `zod` only and holds schemas, inferred types, and the `Result`
helper, with no game logic (CON-001, CON-002,
[01-architecture.md §2](../../spec/01-architecture.md)).

## Public API

- `@mythos/contracts`: every schema and type, re-exported by `src/index.ts`.
- `@mythos/contracts/content`: the content schemas, re-exported by
  `src/content/index.ts`.

Both entry points export TypeScript source; there is no build step (ARCH-005).

## What is in `src/`

Each file is specified in a spec document:

- [03-contracts.md](../../spec/03-contracts.md): `primitives.ts`, `rules.ts`, `ruling.ts`,
  `entities.ts`, `world-state.ts`, `turns.ts`, `memory.ts`, `commits.ts`, `models.ts`,
  `errors.ts`, `result.ts`, `events.ts`, `app-api.ts`, and `index.ts`
- [04-content-schemas.md](../../spec/04-content-schemas.md): `content/`, except
  `content/theme.ts`
- [05-providers.md](../../spec/05-providers.md): `machine-config.ts`
- [06-turn-engine.md](../../spec/06-turn-engine.md): `turn-api.ts`
- [08-memory.md](../../spec/08-memory.md): `extraction.ts`
- [09-context.md](../../spec/09-context.md): `model-outputs.ts`
- [10-journal.md](../../spec/10-journal.md): `journal.ts`
- [12-time-world.md](../../spec/12-time-world.md): `world-tick.ts`
- [14-ui.md](../../spec/14-ui.md): `views.ts` and `content/theme.ts`
- [15-media.md](../../spec/15-media.md): `media.ts`

## Rules

`src/` is a byte-for-byte copy of `spec/reference/contracts/` (OVR-033), and the spec
check in `pnpm check` (`scripts/check-spec.ts`) fails on any difference. Never edit it
here: change the spec and its reference file, then copy the file again. Prettier
ignores `src/` for the same reason.
