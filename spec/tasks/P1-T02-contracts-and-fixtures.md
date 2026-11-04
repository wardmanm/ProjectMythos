# P1-T02: Install contracts and fixtures; add the spec check

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T01 |
| **Branch** | `p1-t02-contracts-and-fixtures` |

## Goal

Copy the normative contracts and fixtures into the repository and add the check
that keeps them identical to the spec, so no later task can drift from it.

## Read

- `spec/00-overview.md` §8.5, §8.6
- `spec/03-contracts.md` §1, §2
- `spec/reference/README.md`
- `spec/decisions/ADR-016-fixtures-and-reference-code.md`

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

OVR-030, OVR-031, OVR-033, OVR-037, OVR-038, CON-001, CON-002, ARCH-004, CONV-122

## Outputs

- `packages/contracts/src/**`: every file of `spec/reference/contracts/` except tests, copied byte for byte
- `packages/contracts/package.json` (dependency: `zod`, the exact version in `spec/reference/package.json`), `README.md`
- `content-library/**`: a copy of `spec/fixtures/library/**`
- `content-packs/reference/**`: a copy of `spec/fixtures/packs/reference/**`
- `scripts/check-spec.ts` and `scripts/check-spec.test.ts`
- Root `package.json`: `check` also runs `tsx scripts/check-spec.ts` and `pnpm --filter @mythos/spec-reference check`; a new `trace` script runs `pnpm --filter @mythos/spec-reference trace`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- Any file under `packages/contracts/src/` after copying it

## Design notes

- **Copy, never retype.** Use a file copy, then confirm with the check below.
- **`scripts/check-spec.ts`** reports every difference, then exits non-zero if any:
  1. every file under `spec/fixtures/library/` exists with identical bytes under
     `content-library/`, and every file under `spec/fixtures/packs/reference/` under
     `content-packs/reference/` (OVR-030). Extra files in the copies are allowed
     (engine templates arrive in P1-T18);
  2. `packages/contracts/src/` and `spec/reference/contracts/` contain the same files
     (tests excluded) with identical bytes, in both directions (OVR-033).
  Compare bytes. `.gitattributes` already forces LF, so Windows checkouts match.
- `check-spec.test.ts` builds small trees in `os.tmpdir()` and proves each kind of
  difference is reported: a missing copy, a changed byte, an extra contract file.
- `spec/reference` is a workspace package (ADR-016); make sure `pnpm install` at the
  root installs its dependencies and its `check` script passes from the root.
- **The docs check** (OVR-038) and `pnpm trace` (OVR-037) are already written:
  `spec/reference/scripts/check-docs.ts`, run by the reference package's `check` and
  `trace` scripts. Nothing is ported. It finds the repository root from its own path
  and, from here on, also reads test names and `Implements` comments under `apps/`,
  `packages/`, and `scripts/`. Name the `check-spec` tests by OVR-030 and OVR-033
  (CONV-111). CON-001, CON-002, and ARCH-004 are met by the copied package rather than
  by a test: give each an `ID: what shows it` entry under **Not tested** (CONV-135).

## Acceptance

- [x] `pnpm check` passes, including the spec check and the reference package's own check.
- [x] Changing one byte in `content-packs/reference/setting.json` or in `packages/contracts/src/rules.ts` makes `pnpm check` fail with a message naming the file (verify, then revert).
- [x] Tests cite OVR-030 and OVR-033.
- [x] `pnpm trace` lists every phase-1 task and the requirement counts for each document; with this task marked Done, `pnpm check` still passes.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `packages/contracts/src/`: the 33 files of `spec/reference/contracts/`, copied with
    `fs.cpSync` (there are no contract tests to leave out). The package depends on
    `zod` 4.6.5, and its README maps each file to the document that specifies it.
  - `content-library/` (16 files) and `content-packs/reference/` (51 files), copied the
    same way.
  - `scripts/check-spec.ts` compares the three copies with their sources byte for byte
    and prints each file that is missing, differs, or has no source, then exits 1.
    `scripts/check-spec.test.ts` has 9 tests citing OVR-030 and OVR-033.
  - The root `check` also runs the spec check and `spec/reference`'s own check (drift
    and docs checks), as CONV-122 lists. `pnpm trace` runs the reference package's
    trace and lists all 25 phase-1 tasks.
  - Verified, then reverted: one changed byte in a comment in
    `packages/contracts/src/rules.ts` fails `pnpm check` with
    `packages/contracts/src/rules.ts differs from spec/reference/contracts/rules.ts`, and
    one in `content-packs/reference/setting.json` with the matching message.
  - `pnpm check` passes. The workspace has `Tests  25 passed (25)` and `spec/reference`
    `Tests  267 passed (267)`, and it ends with `Docs check passed: 834 requirements, 25
    tasks (2 done), 19 ADRs, 74 markdown files, 28 citations in code.`
- **Rulings:**
  - **OVR-033, MEM-041, spec fix** (`P1-T02: spec: drop an unused local in
    makeExtractionSchemas`). `makeExtractionSchemas` declared `const stat` and never
    used it. That is a lint error in the copy, which cannot be edited. The line is
    removed from `spec/reference/contracts/extraction.ts` and from the matching
    `08-memory.md` block. The stat hints key a strict object by the ruleset's stat IDs,
    and in the other branch `stat` would equal `StatIdSchema`, which the code uses
    directly, so nothing changes. 03-contracts gains a Traps entry for it.
  - **The tests run the spec check as `pnpm check` does,** in a child process
    (`node --import tsx`), rather than importing it. They cover the exit code and the
    messages, and the script needs no guard against running on import.
  - **A missing source folder fails the check** rather than passing with nothing
    compared, which the design notes don't mention.
  - **Extra files** (CONV-132): `scripts/README.md` lists the script, and the root
    `README.md` describes `pnpm check` and `pnpm trace` (CONV-023).
  - **`tsx` 4.23.15 joins the root dev dependencies,** the reference's version, so the
    root `check` can run the script.
  - **The copies were made once with `fs.cpSync`,** not by a committed script. The spec
    check catches any later difference.
- **Pending decisions:** None.
- **Not tested:**
  - CON-001: every type in `packages/contracts/src/` is `z.infer` of a schema. The files
    are the spec's own, and the spec check keeps them identical.
  - CON-002: `packages/contracts/src/` holds only schemas, inferred types, and the
    `Result` helper, as the copied files show.
  - ARCH-004: `packages/contracts/package.json` names `@mythos/contracts`, exports `.`
    and `./content`, and depends on `zod` only.
- **Dependencies:**
  - `zod` 4.6.5 in `packages/contracts`, on CONV-091's list.
  - `tsx` 4.23.15 as a root dev dependency, on CONV-091's list (ADR-015).
