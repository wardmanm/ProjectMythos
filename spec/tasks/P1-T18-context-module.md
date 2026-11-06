# P1-T18: Context module and narrator templates

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T14, P1-T17 |
| **Branch** | `p1-t18-context-module` |

## Goal

Build the narrator's prompt for a turn: templates with layers, locked content, the
phase-1 tiers, budgets, cache breakpoints, and the tier report the inspector shows.
Write the engine's default narrator templates.

## Read

- `spec/09-context.md` §1 to §5, §6.1, §7 (narrator column), §8, §9, §10, §11, §12
- `spec/13-content-settings.md` §3, §5
- `spec/05-providers.md` PRV-072
- `spec/10-journal.md` JRN-020, JRN-024
- `spec/11-gear.md` §6
- `spec/12-time-world.md` §2.1
- `spec/04-content-schemas.md` §2.1 (SCH-023), §8.2 (SCH-073)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

CTX-001, CTX-002, CTX-003, CTX-004, CTX-005, CTX-006, CTX-007, CTX-008, CTX-010, CTX-012, CTX-013, CTX-030, CTX-031, CTX-032, CTX-033, CTX-034, CTX-041, CTX-052, CTX-071, CTX-076, CTX-081, CTX-090, CTX-101, CTX-102, CTX-106, CTX-110, SCH-023, CSET-010, CSET-011, CSET-012, CSET-040, CSET-042, CSET-046, CSET-062, PRV-072, CONV-115

## Outputs

- `apps/server/src/modules/context/`: `index.ts`, `types.ts` (the 09-context §10 code block, verbatim), `templates.ts` (Handlebars, layers, helpers), `narrator.ts` (view model and recipe), `tiers.ts` (layout and budgets), tests with snapshots, `README.md`
- `content-library/templates/narrator.md` and `content-library/templates/partials/` (`tone`, `content-settings`, `narration-style`, `pc-sheet`, `character-public`, `transcript`)

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/contracts/`
- `content-library/` files that came from fixtures

## Design notes

- **Dependencies** (CTX-110): `createContextBuilder` takes `ContextDependencies` from the
  composition root, plus the storage, content, and memory APIs it may import. It never
  imports `config` or `providers`; P1-T20 wires the real functions, and tests pass
  fakes.
- Implement only `narration` and `preview` from `ContextBuilder` now; the other methods
  return an error naming their phase. Builders return `Result` (CTX-110).
- **Turn zero** (CTX-076): the root turn has no input, so its `turn` tier holds the
  scenario's opening file from the snapshot, and the task is to open the story.
- **Phase-1 narrator recipe** for ordinary turns: `instructions` (narration style, tone, content settings,
  hard floor appended by code, CTX-007); `world` (setting summary, PC sheet); `scene`
  (place, date and time of day, present characters' public blocks: display names for
  the PC, appearance from `appearanceOf`, personality); `transcript` (verbatim
  turns of the current scene, rolled by chunks with `transcriptBoundary`; rolled turns
  are left out until phase 2); `turn` (the input); `task` ("Write the narration").
  There is no ruling yet, so the instructions tell the narrator to decide outcomes
  from the fiction, fairly, and to leave room for the player to act. Phase 3 replaces
  this wording.
- Display names come from the fold's learned names (JRN-020): Odette is "the
  innkeeper" until Wren learns her name.
- Read at the turn's narration read point (TRN-060): the parent turn's folded state
  plus this turn's input.
- Engine templates are prompt writing: keep them short, concrete, and in the
  narration-style partial's voice. Snapshot-test every template against the
  reference campaign built by P1-T17 with seeded IDs (CONV-115).

## Acceptance

- [x] CTX-102: building the same prompt twice yields identical bytes.
- [x] CTX-101: across three consecutive turns in one scene, tiers 1 to 4 are byte-identical except for appended transcript turns.
- [x] CTX-106: a campaign override of `partials/tone.md` wins over the engine's; no override can remove the hard floor.
- [x] CSET-046, CSET-062: the floor is in every rendered narrator prompt, twice when Pip is present.
- [x] CTX-032: a context window too small for the fixed tiers fails with `context_overflow` naming each fixed tier.
- [x] The inspector report lists each tier's budget, estimate, trimmed items, and cached-prefix flag (CTX-090).
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/context/`:
    - `types.ts`: the 09-context §10 code block, byte for byte. `scripts/check-spec.ts`
      compares it with its source like `providers/types.ts`, and `.prettierignore`
      leaves it alone;
    - `templates.ts`: the six layers in priority order, and each template's partials,
      found by walking the Handlebars syntax tree;
    - `helpers.ts`: the Handlebars environment: strict, `noEscape`, and
      `knownHelpersOnly`, with `join` and `label`, and `lookup` and `log` removed;
    - `read.ts`: the campaign at a read point;
    - `narrator.ts` and `narrator-view.ts`: the narrator's phase-1 recipe and view model;
    - `tiers.ts`: tier markers, locked content, the CTX-010 layout, and the reports;
    - `budget.ts`: `fitPrompt`: budgets, the scene's trims, the transcript's rolling, and
      the PRV-072 check;
    - `builder.ts`: `createContextBuilder`; `index.ts`; `README.md`; and `testing.ts`,
      not exported.
  - `content-library/templates/`: `narrator.md`, with its tier markers, and the `tone`,
    `content-settings`, `narration-style`, `pc-sheet`, `character-public`, and
    `transcript` partials.
  - `packages/core`: `estimateTokens` moved into `prompts/context.ts` (Q2), with its
    PRV-070 test, and `CATEGORY_LABELS` exported, so the content-settings partial prints
    the same names and wording as `renderContentSettings`. README updated.
  - 78 tests in six files: `templates.test.ts`, `tiers.test.ts`, `budget.test.ts`, and
    `narrator.test.ts` in context, and `turn/narrator-prompt.test.ts` and
    `turn/narrator-layers.test.ts`, which build prompts for the reference campaign made
    by `createCampaign` with seeded IDs and played on with stored sets. The preview
    snapshots of every engine template, at turn zero and at the third turn, are
    `turn/__snapshots__/narrator-prompt/*.txt` (CONV-115).
  - Acceptance, by test (the checklist is ticked):
    - CTX-102: `building the same prompt twice, or in a second campaign made the same
      way, gives the same bytes`;
    - CTX-101: `across three turns in one scene, tiers 1 to 4 change only by appended
      transcript turns`;
    - CTX-106: `a campaign override of partials/tone.md wins over the engine's, and the
      floor stays`;
    - CSET-046, CSET-062: the floor once with a stripped campaign `narrator.md`, a
      model-profile `narrator.md`, a pack tone profile's partial, and a `tone` override,
      and `with Pip present the floor appears twice, the task tier ends with it, and
      sexual is off`;
    - CTX-032: `a window too small for the fixed tiers fails with context_overflow
      naming each one`, and the budget tests;
    - CTX-090: `the inspector gets each tier's budget, estimate, trims, and
      cached-prefix flag, and the templates`, and `each tier reports its budget,
      estimate, what was trimmed, and whether it is cached`.
  - `pnpm check` passes on the branch rebased onto `origin/main` (d040329, with P1-T15).
    The workspace has `Tests  1011 passed (1011)` and `spec/reference` `Tests  271
    passed (271)`, and it ends with `Docs check passed: 834 requirements, 25 tasks (19
    done), 20 ADRs, 84 markdown files, 1309 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, while planning, 2026-11-06):
    - Q1: `narrator.md` marks where each tier starts with `<!-- tier: <name> -->` lines,
      each once and in tier order, and a missing, repeated, out-of-order, or unknown
      marker fails with `validation_failed` naming the file and layer. CTX-003 gains one
      sentence, in `P1-T18: spec: CTX-003 tier markers`; 09-context Decisions row.
    - Q2: `estimateTokens` lives in `core`; `providers/tokens.ts` re-exports it, and the
      providers `index.ts` is untouched. The 05-providers owner row is amended and its
      Open entry removed, in `P1-T18: spec: estimateTokens lives in core`.
    - Q3: the budget takes `reservedTokens`, taken off before allocation, on its own line
      in the overflow message, and counted in the PRV-072 check; the narrator passes 0.
      09-context Decisions row, and its Open entry rewritten: phase 3 computes it per
      structured role, and a retry's failed answer and problems are still unreserved.
    - Q4: a scene still over budget at its last trim is kept whole like a fixed tier,
      and the transcript absorbs the shortfall; if that does not fit, `context_overflow`
      lists the scene with the fixed tiers. 09-context Decisions row.
  - **Spec fix** (CONV-133): the 13-content-settings Decisions row on
    `appendFloorToTask` said "after the output-format instructions", stale since PRV-050
    gave the format instruction a message of its own. Reworded in `P1-T18: spec: the
    floor ends the task tier, with no format instruction after it`, and core's comment
    in a code commit. The decision is unchanged.
  - **09-context Decisions, Claude (ruling):** text before the first tier marker fails;
    `{{> name}}` is `partials/<name>.md`, and `templates` lists `<layer>:<path>`; how a
    template fails (`validation_failed`, or a throw when every file used is the
    engine's); `label`'s keys; the scene holds the place's name and runtime
    `description`, never its canon Markdown; who is involved in phase 1; the scene's
    trim order, an appearance's "one line" being its first sentence; phase-1 tiers and
    reports (no state or knowledge, weights 15 and 45, an empty tier with no message);
    and what `preview` renders.
  - **09-context Traps** (new section): strict mode's lenient block-helper parameters;
    a view key named like a helper; each tier counting its separator; a verbatim tail
    that can move back; a partial's final newline.
  - **09-context Open:** the format-instruction entry rewritten (Q3); added: characters
    listed by ID, not join order; the transcript's phase-1 contents (no roll lines, no
    OOC dropping); the view model is not kept; folding at a read point written twice.
  - **Extra files** (CONV-132):
    - As planned: `apps/server/package.json` and `pnpm-lock.yaml`; `scripts/check-spec.ts`
      and `.prettierignore`; `turn/snapshot.test.ts`; `turn/narrator-prompt.test.ts` and
      its snapshots; `context/read.ts`; core and `providers/tokens.ts` (Q2).
    - Beyond the plan: `context/budget.ts`, `helpers.ts`, `narrator-view.ts`, and
      `builder.ts`, to keep files under 300 lines (CONV-014), with `budget.test.ts`;
      `turn/narrator-layers.test.ts` and `turn/prompt-testing.ts`, the end-to-end tests
      split in two with their shared helpers; `scripts/check-spec.test.ts`, whose fake
      repository needs the new source; core's `CATEGORY_LABELS` export; and the core,
      providers, and turn READMEs.
  - **Smaller calls:**
    - `createContextBuilder` takes the campaign store, not an open database as the plan
      said, because the campaign row is read through the store.
    - `turn/snapshot.test.ts`: both CTX-005 tests read the repository's engine folder;
      the first now removes its copied library's templates, and the second points the
      engine at an empty folder.
    - The PC is a present character in the scene, listed by ID like everyone else and
      marked as the player's character, with appearance but not personality, which the
      world tier's PC sheet has.
    - "Involved" matches the name the PC knows, case-insensitively, with or without a
      leading article.
    - Each transcript turn is estimated alone for `transcriptBoundary`; the tail is then
      rendered and checked, and rolled again while a template makes it too big.
    - `narration` throws when `point.turnId` is not `turnId`, a caller's defect.
    - Template errors give lines and columns counted from 1.
    - `preview` goes through the budgets, so it needs a configured narrator profile.
    - The Acceptance checklist is ticked.
- **Pending decisions:** None.
- **Not tested:** None. CTX-110's import rule is also enforced by lint.
- **Dependencies:** `handlebars` 4.7.10 in `apps/server`, from CONV-091's approved list;
  the lockfile already had it, through `eslint-plugin-boundaries`, and it ships its own
  types.
