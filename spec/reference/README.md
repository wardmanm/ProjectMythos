# Reference code (non-normative)

This folder holds the code that was written to validate the spec before any task
existed. Every subsystem with pure logic was implemented here first, tested, and only
then written up as requirements. It is a working example, not the product.

**The spec wins.** If anything here disagrees with a spec document, the document is
right (OVR-031). Handle the disagreement under CONV-133: fix whichever side is plainly
wrong and record it as a ruling, or raise it as a pending decision.

## Running it

Needs Node 22 or later and pnpm. In the repository this folder is a workspace package,
`@mythos/spec-reference`, and the root `pnpm check` runs its `check` script, so drift
fails the build. It also runs on its own:

```
pnpm install
pnpm check          # typecheck, tests, fixture check, drift check, docs check
pnpm trace          # task status and requirement counts (OVR-037)
```

With pnpm 11 or later, `pnpm install` run here exits with `ERR_PNPM_IGNORED_BUILDS` for
esbuild's build script until the repository's root `pnpm-workspace.yaml` exists, since
that file approves the build (`allowBuilds`). The packages are installed all the same,
and `pnpm check` passes. The failed install also leaves a `pnpm-workspace.yaml` in this
folder whose `allowBuilds` entry for esbuild is a placeholder; setting it to `true`
approves the build here. Delete that file once the root one exists: while it is here,
pnpm treats this folder as a workspace of its own.

| Script | What it does |
|---|---|
| `pnpm test` | Runs the Vitest suite (`core/*.test.ts` and `scripts/docs/docs.test.ts`) |
| `pnpm typecheck` | `tsc --noEmit` over everything, with the repository's strict settings (CONV-001) |
| `pnpm check:fixtures` | Validates every file in `spec/fixtures/`: schemas, file names, cross-references, gear placement, history, relationships |
| `pnpm check:drift` | Proves every code block in the spec matches this code or a fixture (OVR-033) |
| `pnpm check:docs` | The docs check: requirement IDs, task files, links, and the trace from tests back to the spec (OVR-038) |
| `pnpm trace` | Prints each task's status and, per document, the requirements defined, retired, done, and tested (OVR-037) |

## What is here, and where it goes

| Folder | Contents | In the repository |
|---|---|---|
| `contracts/` | Every Zod schema. Identical to the code blocks in `03-contracts.md`, `04-content-schemas.md`, and later documents | `packages/contracts/src/`, copied verbatim |
| `server-types/` | Public interface types for three server modules, as shown in `05-providers.md`, `08-memory.md`, and `09-context.md` | `apps/server/src/modules/{providers,memory,context}/`, copied verbatim |
| `core/` | Pure logic and its tests | `packages/core/src/`, ported (below), each file in the folder of its governing document (01-architecture Decisions) |
| `scripts/check-fixtures.ts` | A complete fixture validator | A starting point for the content loader's cross-reference checks (SCH §10) |
| `scripts/check-drift.ts` | Spec-to-code drift check | The basis of the repository's spec check (OVR-030) |
| `scripts/check-docs.ts`, `scripts/docs/` | The docs check and `pnpm trace` (OVR-037, OVR-038), with its tests. Unlike the rest of this folder, it is written to the conventions | Stays here and is not ported; the root `check` and `trace` scripts run it (P1-T02) |
| `test-support/harness.ts` | `eq`, `near`, `fixturePath` helpers | Not ported |

The contracts import each other with relative paths, and everything else imports them
as `@mythos/contracts` and `@mythos/contracts/content` (ARCH-004). Here those names
are mapped to `contracts/` by `tsconfig.json` and `vitest.config.ts`.

### `core/` by spec document

| File | Implements |
|---|---|
| `compare.ts` | Code-point string comparison (CONV-087) |
| `rules.ts`, `ruleset-check.ts` | Dice methods, odds, results, effect, harm placement and penalties, resistance, healing, clocks; ruleset validation and ruling limits (`07-rules.md`) |
| `turn-logic.ts` | Active sets, staleness, set ordering, copy-on-write ID remapping (`06-turn-engine.md`) |
| `memory.ts` | Extraction to commits with semantic checks, retrieval scoring and packing, consolidation groups (`08-memory.md`) |
| `context.ts` | Tier budget allocation, key-speaker selection, transcript chunk rolling (`09-context.md`) |
| `journal.ts` | Known entities, display names, visible sections, common knowledge (`10-journal.md`) |
| `gear.ts` | Possession, appearance, container and encumbrance checks, item moves (`11-gear.md`) |
| `calendar.ts`, `world.ts` | Calendar math, formatting, durations; world-tick actors, batching, stat-change pace, world tick to commits (`12-time-world.md`) |
| `content.ts` | The hard floor, effective content settings, prompt wording (`13-content-settings.md`) |
| `theme.ts` | WCAG contrast and theme checks (`14-ui.md` §3) |
| `media.ts` | ComfyUI mapping, content negatives, speech segmenting and sentence splitting, voice assignment (`15-media.md`) |

## Porting rules

A task MAY port code from here instead of writing it from scratch (OVR-032). When it
does:

1. **Read the requirement first, then the code.** The requirement is what you are
   implementing; the code is one way to do it.
2. **Meet the conventions.** This code was written for speed of validation. It is dense:
   long lines, compact helpers, few comments. Ported code must follow
   `02-conventions.md`: Prettier formatting, JSDoc on exported functions (CONV-022),
   requirement citations (CONV-021), and the size limits (CONV-014). `memory.ts`
   (317 lines) should be split.
3. **Rename every ported test** so it starts with the requirement ID it verifies
   (CONV-111), and use `it`/`expect` directly rather than the `eq` helper. A test that
   verifies no requirement is a defect (OVR-021): find the requirement, or drop the test
   and say why in the task's completion notes.
4. **Keep fixtures in place.** Tests here read `spec/fixtures/` through `fixturePath`.
   In the repository, library and pack data come from the copies in `content-library/`
   and `content-packs/reference/`, and test-only data is read from `spec/fixtures/test/`.
5. **Do not port** `test-support/harness.ts`, the `@mythos/*` path mapping, or anything
   not listed in the task.

## Known gaps

- There is no server implementation here: no storage, HTTP, providers, queue, or prompt
  rendering. Only their interface types.
- Tests are organized by behavior, not by requirement ID, and do not cover every
  requirement. The task that ports a file owns completing its tests.
- Odds tables in `07-rules.md` were generated from `rules.ts`; the generator is not
  included. The rules tests check the same odds.
