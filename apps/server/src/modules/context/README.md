# context

Every model call's prompt starts here ([09-context.md](../../../../../spec/09-context.md)).
The module turns a read point into a complete prompt for one model role: templates found
in six layers and rendered against a view model built in code, the locked content code
adds, the tiers laid out in messages with cache breakpoints, budgets that fit the model,
and the report the inspector shows. Phase 1 builds the narrator's prompt; the other
roles' recipes arrive with their phases. Its code imports only `storage` (its tests also
use `content`), and never `config` or `providers`: the composition root passes what it
needs (ARCH-021, CTX-110).

## Public API (`index.ts`)

- **Types** from `types.ts`, a byte-for-byte copy of the 09-context §10 code block:
  `ContextBuilder`, `ContextDependencies`, `BuiltPrompt`, `Built`, and `KeySpeaker`. Never
  edit it here; `pnpm check` fails if it differs from
  `spec/reference/server-types/context/types.ts`.
- `createContextBuilder({ dependencies, store, campaignId })` returns the
  `ContextBuilder` for one open campaign, because a `ReadPoint` names no campaign. It
  opens the campaign's database through the store for each prompt. `dependencies`
  (`ContextDependencies`) gives the profile and calibrated ratio a role's call will use
  (`profileFor`), machine config's `context` section (`contextSettings`), and the model
  profile's template folder (`profileTemplateDir`). Every builder returns a `Result`:
  - `narration(point, turnId, voiced, instruction)` builds the narrator's prompt at the
    turn's narration read point (TRN-060); `point.turnId` must be `turnId`. A
    `not_configured` from `profileFor` is passed through, and fixed tiers too big for
    the profile are `context_overflow` (CTX-032). Voiced lines (phase 4) and a
    regeneration direction (phase 2) are `internal_error`, naming their phase.
  - `preview(point, templateName)` builds the same prompt without calling a model and
    returns it as text, each message under a line naming its role and tiers (CTX-008).
    It takes `narrator.md` or any file that prompt used; another file is `not_found`,
    and a name that is not a template path is `validation_failed`.
  - `adjudication`, `npcVoice`, `extraction`, `suggestions`, `transcriptSummary`, and
    `consolidation` return `internal_error` naming the phase that brings them, and
    `keySpeakers`, which returns no `Result`, rejects naming phase 4.

A `BuiltPrompt` has the `messages`, one `TierReport` per tier of the recipe (budget,
estimate, what was trimmed, and whether it is in the cached prefix, CTX-090), `retrieved`
(empty until phase 4), and `templates`, each file used as `<layer>:<path>`, sorted.

## How a prompt is built

1. **Read** (`read.ts`). `readAtPoint(store, db, point)` reads the campaign record, its
   canon (setting, calendar, slot schema, tone profile, ruleset, scenario and its
   opening), the current content settings, and the point's active sets, put in order with
   core's `entriesInOrder` and folded from `initialState`. From the same sets it takes the current
   scene's earlier narrated turns (since the last `scene.start`) and the point's turn:
   the root turn opens the story (CTX-076); any other turn has its input.
2. **Find the templates** (`templates.ts`). `layeredLookup` finds a file in the
   campaign's overrides (`template:<path>` in `campaign_state`), then the model profile's
   folder, then the snapshot's tone-profile, pack, ruleset, and engine layers, in that
   order (CTX-004), and gives LF text without a BOM. `prepareTemplate` loads the
   top-level file and, by walking the Handlebars syntax tree, every partial it uses:
   `{{> tone}}` is `partials/tone.md`. A missing partial, a partial that includes
   itself, a partial block, an inline partial, or an unknown helper fails before
   anything renders.
3. **Render** (`helpers.ts`). Each prompt gets a Handlebars environment of its own:
   `strict`, `noEscape`, and `knownHelpersOnly`, with `join`, the ruleset's `label`
   (`result.<tier>`, `effect.<level>`, `harm.<n>`), and `lookup` and `log` removed
   (CTX-001, CTX-002). An override that fails is `validation_failed`, naming the file and
   its layer; when every file used is the engine's, it throws.
4. **View model** (`narrator.ts`, `narrator-view.ts`). `narratorRecipe(at)` builds the
   `NarratorView` (CTX-006): narration-style and tone flags, the content settings with
   core's default wording and a flag per level (CSET-010, CSET-011), the setting and the
   PC sheet, the scene (the place's name and description, the date in the calendar's
   format, and each present character's public block), the transcript, and the turn.
   Names are display names for the PC (JRN-020, CTX-052), appearance is core's
   `appearanceOf` (GEAR-060), and while a minor is present or named in the input the
   settings render `sexual: off` (CSET-042). It also lists the scene's trims: each
   uninvolved character's personality, then their appearance cut to its first sentence
   (CTX-034).
5. **Tiers** (`tiers.ts`). `splitTiers` cuts the rendered text at its `<!-- tier: … -->`
   markers, which must each appear once and in order (CTX-003). `withLockedContent`
   appends the hard floor to the instructions tier, and to the task tier while a minor
   is present, through core (CTX-007, CSET-040). `layOut` puts the tiers in CTX-010's
   messages, with cache breakpoints after world, scene, and transcript, and estimates
   each tier with the separator before it.
6. **Fit** (`budget.ts`). `fitPrompt` takes `reservedTokens` off the input budget
   (CTX-030), shares the rest with `allocateBudgets` (CTX-031, CTX-033), trims the scene
   step by step, keeps a scene still over its share at its last trim whole (the
   transcript makes up the difference), rolls the transcript by whole chunks with
   `transcriptBoundary` (CTX-041), and checks the whole prompt with `estimateTokens`, the
   estimate calibration uses (PRV-072). The narrator reserves 0.

## Files

`index.ts`, `types.ts` (the verbatim copy), `builder.ts`, `read.ts`, `templates.ts`,
`helpers.ts`, `narrator.ts`, `narrator-view.ts`, `tiers.ts`, `budget.ts`, and
`testing.ts` (test helpers, not exported: the standard ruleset, layers in memory, the
engine's templates, and the reference pack's turn zero built in memory). The engine's
templates are in `content-library/templates/`: `narrator.md` and the `tone`,
`content-settings`, `narration-style`, `pc-sheet`, `character-public`, and `transcript`
partials. Their preview snapshots, against the reference campaign, are in
`turn/__snapshots__/narrator-prompt/`, written by `turn/narrator-prompt.test.ts`; lint
keeps this module's tests from importing `turn`, which creates campaigns.

## Rules for code here

- Tiers 1 to 4 are deterministic (CTX-012): no wall time, characters listed by ID
  (phase 1 has no join order), and lists sorted with `cmp`.
- A view model carries every key, with null for nothing, and no key named `join` or
  `label` (09-context Traps).
- Prompt wording lives in templates. Code builds flags and data, never sentences, except
  core's content-settings wording, which the view model passes through.
- Never reword, move, or drop the hard floor. It comes from `core` and is added after
  every template has rendered (13-content-settings §5, ADR-014).

## Governing spec

- [09-context.md](../../../../../spec/09-context.md) §1 to §5, §6.1, §7 (narrator), §8 to
  §12, and its Traps, Decisions, and Open sections.
- [13-content-settings.md](../../../../../spec/13-content-settings.md) §3 and §5.
- [05-providers.md](../../../../../spec/05-providers.md) PRV-070 and PRV-072.
- [10-journal.md](../../../../../spec/10-journal.md) JRN-020 and JRN-024,
  [11-gear.md](../../../../../spec/11-gear.md) §6, and
  [12-time-world.md](../../../../../spec/12-time-world.md) §2.1.
- [04-content-schemas.md](../../../../../spec/04-content-schemas.md) SCH-023 and SCH-073.
