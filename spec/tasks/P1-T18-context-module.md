# P1-T18: Context module and narrator templates

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] CTX-102: building the same prompt twice yields identical bytes.
- [ ] CTX-101: across three consecutive turns in one scene, tiers 1 to 4 are byte-identical except for appended transcript turns.
- [ ] CTX-106: a campaign override of `partials/tone.md` wins over the engine's; no override can remove the hard floor.
- [ ] CSET-046, CSET-062: the floor is in every rendered narrator prompt, twice when Pip is present.
- [ ] CTX-032: a context window too small for the fixed tiers fails with `context_overflow` naming each fixed tier.
- [ ] The inspector report lists each tier's budget, estimate, trimmed items, and cached-prefix flag (CTX-090).
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
