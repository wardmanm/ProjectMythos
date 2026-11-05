# P1-T04: Port core: hard floor, ruleset and gear checks, names, budgets

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
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

- [x] CSET-060: every category renders at every level, with lines and veils verbatim.
- [x] CSET-061: with a minor involved, `sexual` is `off` and `usesExplicitRoles` returns false (the helper is ported now; routing uses it in phase 3).
- [x] GEAR-053: every illegal move in the reference tests is reported with its plain-English reason.
- [x] CTX-100: fixed tiers exact, trimmable tiers by weight, spill order as CTX-033; CTX-041's 60-turn stability test passes.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `packages/core/src/`: `content.ts`, `ruleset-check.ts`, `gear.ts`,
    `gear-appearance.ts`, `journal.ts`, and `context.ts`, each with its tests (104 in
    all), exported from `index.ts`. The README lists the API.
  - Acceptance, by test:
    - CSET-060: `every category renders at every level`, and lines and veils render
      verbatim after the categories;
    - CSET-061: with a minor, `sexual` is `off`, `usesExplicitRoles` is false, and the
      floor appears twice; with only adults, the settings are unchanged and the floor
      appears once;
    - GEAR-053: every illegal move in the reference tests, plus full hands, a missing
      slot, a missing container, an item that holds nothing, and a cycle already in the
      state, each with its message. Every starting item in the reference pack is legal
      where it starts;
    - CTX-100: fixed tiers exact, trimmable tiers by weight, each step of the spill
      order, profile caps, and overflow naming every fixed tier. CTX-041's 60-turn
      test passes with 6 prefix changes.
  - Wren's appearance, built from the reference pack, reads exactly as the design notes
    give it.
  - `pnpm check` passes. The workspace has `Tests  200 passed (200)` and
    `spec/reference` `Tests  271 passed (271)`, and it ends with `Docs check passed: 834 requirements, 25 tasks
    (5 done), 19 ADRs, 75 markdown files, 262 citations in code.`
- **Rulings:**
  - **Mike's decisions, CTX-030 and CTX-031** (`P1-T04: spec: owner: CTX-030 margin,
    CTX-031 trimmable caps`). The margin is 10% of `contextWindow − maxOutputTokens`,
    and a `contextBudget` cap applies only to trimmable tiers. Both requirements are
    reworded in place, with two rows in 09-context's Decisions.
  - **GEAR-050, GEAR-052, CTX-041, spec fix** (`P1-T04: spec: reference fixes for gear
    and transcript`). The reference disagreed with the spec, so the requirements win
    (OVR-031), and the reference and the port are fixed alike:
    - `validateItemMove` crashed on a move into a missing container;
    - its containment walk looped forever on a cycle already in the state;
    - the hard limit counted only the moved item's own weight, so a full pack moved as
      if empty;
    - `transcriptBoundary` returned `-1` for an empty transcript, and kept an
      over-budget turn when nothing fit.
  - **GEAR-052: the hard limit weighs the holder's load after the move.** The plan said
    to refuse a move only when it raises the load. The pack loader, though, checks each
    starting item as a move to where it already is, so under that rule an over-limit
    starting inventory would pass. The check keeps the reference's rule, with contents
    counted: refuse when the load after the move is over the limit. Recorded in
    11-gear's Decisions.
  - **GEAR-053: `validateItemMove` checks slots and containers.** Whether a character or
    place named by the move exists is left to commit validation (P1-T05) and the pack
    loader (P1-T08). Recorded in 11-gear's Decisions.
  - **CSET-042: `appendFloorToTask` is new.** The reference had nothing for the second
    floor at the end of the task tier, so all floor text is now appended by `core`.
    Recorded in 13-content-settings' Decisions.
  - **CTX-030: `inputBudget` is new.** It computes the margin in integer arithmetic and
    never returns less than 0.
  - **`gear-appearance.ts` is an extra file** (CONV-132, CONV-014). After Prettier,
    `gear.ts` came to 354 lines, so `appearanceOf` and its tests moved out.
    `gear.test.ts` stays at 396 lines, over the 300-line guideline: it holds the
    fixtures and a test for every move rule.
  - **`rulingLimitsFor` is ported and tested as RUL-065,** though the task does not list
    RUL-065: it is in the reference file, which the task ports whole.
  - **Changes from the reference API:**
    - `TierSpec` is `{ tier, need, weight, cap }`, the spec's words, and whether a tier
      is fixed comes from the tier itself;
    - `allocateBudgets` returns a `Result` (CONV-040);
    - `validateItemMove` returns `string[]`, like `rulesetIssues`;
    - `loadOf` takes the character, not its ID as well;
    - `possessor` is a loop;
    - `concealedItemIds` is sorted with `cmp` (CTX-012);
    - `FLOOR_ROLES` and `appendLocked` use `ModelRole`.
  - **Changes from the reference behavior:**
    - `rulesetIssues` gives each message once, where the reference repeated it for each
      offending entry;
    - a layer that doesn't exist reads "the feet slot has only 1 layer", where the
      reference had "the feet has no layer 1";
    - a missing container reads `there is no "item.box" to put it in`;
    - a container's free room is never shown as negative;
    - `commonKnowledge` scans by line instead of a lookahead regex, and returns LF line
      endings.
  - **The CSET-010 test reads the wording table from `spec/13-content-settings.md`**, so
    the code and the spec cannot drift apart.
  - **Not ported:** `selectKeySpeakers` (phase 4), and `knownEntityIds` and
    `visibleSections` (phase 5), as the design notes say. Their reference tests stay in
    `spec/reference`.
- **Pending decisions:** None.
- **Not tested:** None. Every listed behavioral requirement has a test named by its ID.
- **Dependencies:** None.
