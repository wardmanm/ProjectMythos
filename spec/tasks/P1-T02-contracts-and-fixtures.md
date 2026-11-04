# P1-T02: Install contracts and fixtures; add the spec check

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] `pnpm check` passes, including the spec check and the reference package's own check.
- [ ] Changing one byte in `content-packs/reference/setting.json` or in `packages/contracts/src/rules.ts` makes `pnpm check` fail with a message naming the file (verify, then revert).
- [ ] Tests cite OVR-030 and OVR-033.
- [ ] `pnpm trace` lists every phase-1 task and the requirement counts for each document; with this task marked Done, `pnpm check` still passes.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
