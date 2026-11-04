# P1-T04: Port core: hard floor, ruleset and gear checks, names, budgets

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T03 |
| **Branch** | `p1-t04-core-content-gear-context` |

## Goal

Port the remaining pure functions phase 1 needs: the content hard floor and
settings wording, ruleset and gear validation used when loading packs, display names
and common knowledge, and prompt budget allocation.

## Read

- `spec/reference/README.md`
- `spec/13-content-settings.md` §2, §3, §5, §8
- `spec/07-rules.md` §1 (RUL-001, RUL-002) and §12
- `spec/04-content-schemas.md` §7 invariants (SCH-062)
- `spec/11-gear.md` §3 to §6
- `spec/10-journal.md` §3 (JRN-020), §4 (JRN-031)
- `spec/09-context.md` §4, §5 (CTX-041), §12 (CTX-100)
- `spec/reference/core/content.ts`, `ruleset-check.ts`, `gear.ts`, `journal.ts`, `context.ts`, and their tests

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

CSET-002, CSET-010, CSET-040, CSET-041, CSET-042, CSET-060, CSET-061, RUL-002, SCH-062, GEAR-010, GEAR-011, GEAR-030, GEAR-040, GEAR-041, GEAR-042, GEAR-043, GEAR-050, GEAR-051, GEAR-052, GEAR-053, GEAR-060, GEAR-061, GEAR-062, GEAR-065, JRN-020, JRN-031, CTX-030, CTX-031, CTX-033, CTX-041, CTX-100

## Outputs

- `packages/core/src/content.ts`, `ruleset-check.ts`, `gear.ts`, `journal.ts`, `context.ts`, each with a `.test.ts`
- `packages/core/src/index.ts` exports
- `packages/core/README.md` updated

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`

## Design notes

- From `journal.ts` port only `displayName` and `commonKnowledge`; the rest belongs to
  phase 5. From `context.ts` port `allocateBudgets` and `transcriptBoundary`;
  `selectKeySpeakers` belongs to phase 4. Port `content.ts`, `ruleset-check.ts`, and
  `gear.ts` whole.
- `HARD_FLOOR` and `FLOOR_ROLES` are copied exactly; the wording is normative
  (CSET-040). Do not rephrase it, even to fix style.
- Tests read the standard ruleset and slot schema from `content-library/` and
  `content-packs/reference/`.
- Add a test that renders Wren's appearance from the reference pack's items: *"Slight
  and freckled, with dark hair cropped short and a watchful look. Wearing: oilskin
  cloak, wool trousers, boots. Holding: carpetbag."* (GEAR-062, GEAR-065).

## Acceptance

- [ ] CSET-060: every category renders at every level, with lines and veils verbatim.
- [ ] CSET-061: with a minor involved, `sexual` is `off` and `usesExplicitRoles` returns false (the helper is ported now; routing uses it in phase 3).
- [ ] GEAR-053: every illegal move in the reference tests is reported with its plain-English reason.
- [ ] CTX-100: fixed tiers exact, trimmable tiers by weight, spill order as CTX-033; CTX-041's 60-turn stability test passes.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
