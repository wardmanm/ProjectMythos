---
doc: 09-context
title: Mythos — Context and Prompts
status: draft
schemaVersion: 1
requirementPrefix: CTX
---

# Context and Prompts

> **For Claude:** this document owns the `context` server module: templates, prompt
> assembly, token budgets, transcript compression, and NPC voicing. `types.ts` is the
> module's public API; `model-outputs.ts` belongs in `packages/contracts/src/`. Both
> were typechecked. The budget, key-speaker, and transcript algorithms were validated
> with a reference implementation.

Every model call starts here. The context module turns a read point (TRN-060) into a
complete prompt for one model role: the right facts, from the right point of view,
within the model's budget, in an order that lets the model reuse its cache.

## 1. Principles

- **Prompts are data; structure is code.** Wording lives in editable Markdown
  templates. What goes into a prompt, in what order, and the output format are decided
  by code, so editing a template can never break parsing (PRV-050).
- **Stable first.** Prompts are ordered from what changes least to what changes most,
  so local runtimes reuse their cache and cloud providers bill cached input.
- **Point of view is structural.** Each role sees what it should: the adjudicator sees
  the truth it needs to judge; a key NPC's voice sees only that NPC's knowledge; the
  narrator never sees a key NPC's secrets. This is enforced by what is put in the
  prompt, not by asking the model to ignore things.
- **Everything is inspectable.** Every prompt records its tiers, budgets, what was
  trimmed, which memories were chosen and why, and which template files produced it.

## 2. Templates

### 2.1 Files and syntax

- **CTX-001** Templates are Markdown files rendered with Handlebars, configured with
  `strict: true` (a missing variable is an error) and `noEscape: true` (prompts are not
  HTML).
- **CTX-002** Templates use only `{{value}}`, `{{#if}}`, `{{#unless}}`, `{{#each}}`,
  `{{#with}}`, partials (`{{> name}}`), and the registered helpers `join` (list,
  separator) and `label` (a ruleset label by key). No other helpers exist. Templates
  never compute: anything that needs logic is prepared in code, in the role's view
  model (CTX-006).
- **CTX-003** A template is a top-level file per role, composed of partials, so a layer
  can replace one section without copying the rest. A top-level template marks where
  each tier of its role's recipe starts with a line such as `<!-- tier: world -->`,
  once per tier and in tier order, and a template whose rendered text has a missing,
  repeated, out-of-order, or unknown marker fails with `validation_failed`, naming the
  file and its layer.

| Template | Role | Purpose |
|---|---|---|
| `adjudicator.md` | adjudicator | Rule on the player's action |
| `narrator.md` | narrator | Describe the resolved turn |
| `npc-voice.md` | npc-voice | Speak and act as one key NPC |
| `extractor.md` | extractor | Turn the turn into memory (08-memory §4) |
| `suggestions.md` | adjudicator | Suggested actions (TRN-059) |
| `transcript-summary.md` | consolidator | Summarize a chunk of turns or a finished scene |
| `consolidator.md` | consolidator | Summarize observation groups and compact wiki pages (MEM §8) |
| `world-ticker.md` | world-ticker | Off-screen NPC activity (`12-time-world.md`) |
| `tone-parser.md` | adjudicator | Free text to tone profile (phase 8) |
| `image-portrait.md`, `image-place.md`, `image-scene.md`, `image-item.md` | illustrator | Image prompts (MED-024) |
| `speech-segmenter.md` | speech-segmenter | Split narration by speaker (MED-055) |

Shared partials live in `partials/`: for example `tone`, `content-settings`,
`ruleset-guide`, `pc-sheet`, `character-public`, `character-knowledge`, `transcript`,
`clocks`, `importance-rubric`, `stakes-rules`, `narration-style`.

### 2.2 Layers

- **CTX-004** A template or partial name resolves to the first file found in this
  order, highest priority first:

| Priority | Layer | Location | Typical use |
|---|---|---|---|
| 1 | Campaign | The campaign's template overrides | The player tuning one campaign |
| 2 | Model profile | `<dataDir>/library/templates/profiles/<profileId>/` | Blunter instructions for a small local model |
| 3 | Tone profile | The tone profile's `templates/` (pack or library) | A grimdark narration style |
| 4 | Pack | `<pack>/templates/` | A setting's special vocabulary |
| 5 | Ruleset | The ruleset's `templates/` | Rules guidance for a different system |
| 6 | Engine | `content-library/templates/` (shipped) | Defaults for everything |

- **CTX-005** Pack, tone, ruleset, and engine templates are snapshotted into the
  campaign at creation (SCH-111). Campaign overrides are stored in `campaign_state`
  with a simple version history; they are not commits, because no game state derives
  from them. Model-profile templates stay on the machine.
- **CTX-006** Each role has a typed **view model** built in code. Templates only read
  it. The inspector can show the view model next to the rendered prompt.
- **CTX-007** **Locked content** cannot be overridden by any layer: the content hard
  floor (CSET-040) and the output-format instructions. The engine adds both after
  rendering. When a minor is involved, the view model renders `sexual: off` and the
  floor is repeated in the task tier (CSET-042).
- **CTX-008** The inspector's preview renders any template against the current campaign
  without calling a model. Snapshot tests render every engine template against a fixed
  fixture campaign (CONV-115).

## 3. Tiers and message layout

Every prompt is built from up to eight **tiers**, always in this order:

| # | Tier | Contains | Changes when | Budget |
|---|---|---|---|---|
| 1 | `instructions` | Role instructions, tone profile, content settings, ruleset guide, hard floor | Campaign settings change | Fixed |
| 2 | `world` | Setting summary, the PC's core sheet (name, stats, personality) | Rarely | Fixed |
| 3 | `scene` | Place and time; present characters' **public blocks** | The scene changes, someone arrives or leaves, appearance changes | Trimmable |
| 4 | `transcript` | Previous scene summaries, chunk summaries, recent turns | A chunk rolls (§5) | Trimmable |
| 5 | `state` | PC statuses, gear, clocks; relevant NPC statuses | Most turns | Trimmable |
| 6 | `knowledge` | **Knowledge blocks**: relationships, wiki sections, retrieved memories; the PC's knowledge and beliefs | Every turn | Trimmable |
| 7 | `turn` | This turn: input, ruling, resolution, voiced lines, the player's regeneration direction | Every turn | Fixed |
| 8 | `task` | What to produce now; output format (engine-appended) | Never | Fixed |

- **CTX-010** Messages are laid out so that cache breakpoints fall after the stable
  tiers:

| Message | Tiers | Cache breakpoint after |
|---|---|---|
| `system` | instructions | — |
| `system` | world | yes |
| `user` | scene | yes |
| `user` | transcript | yes |
| `user` | state, knowledge, turn, task | — |

- **CTX-011** The Anthropic adapter merges consecutive same-role messages into one
  message with one content block per original message, keeping each block's cache
  breakpoint (PRV-041). Its API would combine them itself; merging first keeps the
  request explicit (PRV-043). Adapters for local runtimes pass them through; identical
  prefixes are reused by the runtime's own cache.
- **CTX-012** Tiers 1–4 MUST be deterministic: the same inputs produce the same bytes.
  No wall-clock time, no unordered iteration, no random sampling. Characters are listed
  in the order they joined the scene, then by ID; numbers and dates use fixed formats.
- **CTX-013** Present characters' public blocks change only when what they show
  changes, so a conversation in one place keeps tiers 1–4 identical from turn to turn
  except for appended transcript turns.

## 4. Budgets

- **CTX-030** A prompt's input budget is the profile's `contextWindow` minus
  `maxOutputTokens`, less 10% of that as a safety margin (PRV-072), rounded down: a
  32,768-token window with 2,048 output tokens gives 27,648. Token counts use the
  calibrated estimate (PRV-070).
- **CTX-031** **Fixed** tiers (`instructions`, `world`, `turn`, `task`) get exactly
  what they need. **Trimmable** tiers share the rest by weight. A profile may cap any
  trimmable tier for any role with a `contextBudget` entry keyed `<role>.<tier>`, e.g.
  `narrator.transcript: 6000`. A cap on a fixed tier has no effect.
- **CTX-032** If the fixed tiers alone exceed the budget, the call fails with
  `context_overflow`, naming each fixed tier and its size. Nothing is silently cut
  from instructions or the current turn. The settings screen warns about any text
  profile with a context window below 8,192 tokens.
- **CTX-033** A trimmable tier that needs less than its share takes only what it needs.
  What's left spills to `knowledge`, then `transcript`, then `state`, then `scene`, so no
  budget is wasted.

Default weights among trimmable tiers:

| Role | scene | transcript | state | knowledge |
|---|---|---|---|---|
| adjudicator | 15 | 30 | 15 | 40 |
| narrator | 15 | 45 | 10 | 30 |
| npc-voice | 10 | — | 10 | 80 |
| extractor | 20 | 15 | 10 | 55 |
| suggestions | 20 | 50 | 15 | 15 |
| transcript summary, consolidator | — | — | — | all |

- **CTX-034** Each trimmable tier trims in a fixed order, and the inspector lists what
  was cut:

| Tier | Trimmed in this order |
|---|---|
| `scene` | Personality lines of characters not involved this turn, then their appearance to a name and one line |
| `transcript` | Oldest previous-scene summaries, then the verbatim tail rolls one more chunk (§5) |
| `state` | Statuses of characters not involved, then non-visible clocks, then the PC's carried items |
| `knowledge` | Shared out (CTX-035); within each block, retrieved memories shrink first, then wiki sections (last first), then the relationship summary |

- **CTX-035** The `knowledge` tier is shared out: 25% to the PC's knowledge and
  beliefs, and the rest equally to each character block, with involved characters
  first. A block's unused share passes to the next. Retrieval receives each block's
  share as its `tokenBudget` (MEM-075).

## 5. The transcript

The transcript is the story so far as the player experienced it: their inputs and the
narration, plus short roll lines. It is the PC's point of view, so it is safe in any
prompt that may know what the PC knows.

- **CTX-040** The transcript tier contains, oldest first:
  1. Summaries of the last `previousSceneSummaries` scenes (machine config, default 3).
     Older scenes are left to memory.
  2. Summaries of the current scene's rolled chunks.
  3. The current scene's recent turns, verbatim: input, narration, and one line per
     roll (*"Roll: STR, 3 dice → Partial; Wrenched Wrist (Lesser)"*). OOC exchanges
     older than `oocTurnsKept` are omitted (TRN-020).
- **CTX-041** **Chunked rolling.** The current scene's turns are grouped into chunks of
  `transcriptChunkTurns` (default 8) from the scene's start. The verbatim tail always
  starts on a chunk boundary: the earliest boundary whose tail fits the budget. So
  between rolls the transcript only grows at the end, and tiers 1–4 stay a stable
  prefix. Tested: over 60 turns with a tight budget, the prefix changed only 6 times,
  once per chunk rolled. If even the newest chunk doesn't fit, the tail falls back to
  the newest turns that do.
- **CTX-042** Chunk and scene summaries are written by the `consolidator` role with
  `transcript-summary.md`, in the background, as soon as a chunk is complete or a scene
  ends. They are cached by the exact active narration sets they cover, so editing any
  covered turn invalidates the summary and it is rewritten.
- **CTX-043** If a summary is needed but not ready, the prompt omits those turns, shows
  a marker in the inspector, and requests the summary at interactive priority for the
  next turn. Play never waits for a summary.

## 6. Characters and NPC voice

### 6.1 Public and knowledge blocks

Each character in a prompt has up to two blocks:

| Block | Tier | Contains | Point of view |
|---|---|---|---|
| **Public** | `scene` | Display name, visible appearance (`11-gear.md`), personality, visible harm | What anyone present can see |
| **Knowledge** | `knowledge` | Relationship to the PC, wiki learned sections, retrieved memories | That character's own |

- **CTX-050** Each knowledge block is headed with whose knowledge it is, and the
  instructions state that a character acts only on their own block: *"### What Odette
  knows and feels. Only Odette knows this."*
- **CTX-051** The PC's knowledge block holds the PC's retrieved memories and the
  player's journal beliefs, labeled as beliefs that may be wrong (`10-journal.md`).
- **CTX-052** Names in public blocks are **display names** for the prompt's knower
  (JRN-020): the PC's names in adjudicator, narrator, and suggestion prompts; the NPC's
  own in their voice prompt. The adjudicator also sees each true name, e.g. *"the lean
  clerk (Varek Holm; the PC doesn't know his name)"*, and the narrator is told to call
  characters only by the names the PC knows.

### 6.2 Key speakers

Machine config's `context.npcVoice` sets the mode: `shared` (one narrator call),
`key` (default: separate calls for key NPCs), or `strict` (separate calls for every
speaking NPC).

- **CTX-060** Before narration, the engine picks this turn's **key speakers** from the
  NPCs who are **involved**: addressed or named in the input, a target or actor in the
  ruling, or speaking in the previous turn. In `key` mode, an involved NPC is a key
  speaker if it is flagged (`keyNpc`) or holds a **relevant secret**.
- **CTX-061** A relevant secret is a memory retrieved for that NPC this turn that the
  PC does not know and whose importance is at least `keySecretImportance` (default 7).
  In the reference pack, Varek becomes a key speaker whenever the *Merrow's Luck*
  comes up, because he alone knows he sent her out unseaworthy.
- **CTX-062** At most `maxVoicedNpcsPerTurn` (default 2) are chosen: flagged first,
  then by highest secret importance. Everyone else is narrated in the shared call.

### 6.3 Voicing a key NPC

- **CTX-063** Each key speaker gets an `npc-voice` call (interactive priority, run one
  after another) that returns `NpcVoice`: up to four lines, each with what they say and
  a visible action. If machine config leaves the `npc-voice` role unassigned, the
  narrator's assignment is used.
- **CTX-064** The voice prompt contains only what that NPC could know: their own public
  and knowledge blocks (their own secrets included), the public blocks of everyone
  present, their most recent witnessed observations in place of the transcript, the
  player's input, the turn's outcome, the player-visible consequence descriptions, and
  lines voiced earlier this turn. It contains no other character's knowledge, no truth
  they don't know, and no GM clocks.
- **CTX-065** The player's input may contain the PC's private thoughts. The voice
  template instructs the model to respond only to what is said and done aloud.
- **CTX-066** The narrator receives the voiced lines and must use them as written,
  adding no other dialogue for those NPCs. **A key speaker's knowledge block is left
  out of the narrator's prompt entirely**; only their public block and voiced lines
  are included. Their secrets therefore cannot surface in description either.
- **CTX-067** If a voice call fails after retries, the narrator writes that NPC from
  their public block alone, and the turn is marked in the inspector. Their knowledge
  block is still withheld.

```ts
import { z } from 'zod';
import { EntityIdSchema } from './primitives';

/*
 * Small model-facing output schemas used by 09-context (CON-003, CON-004).
 * Rulings are in ruling.ts and extraction in extraction.ts.
 */

/** What a key NPC says and does this turn, written from their knowledge only (CTX §6). */
export const NpcVoiceSchema = z.object({
  lines: z
    .array(
      z.object({
        says: z.string().max(600), // empty when the character only acts
        does: z.string().max(300).nullable(), // visible action or manner, e.g. "looks away"
      }),
    )
    .min(1)
    .max(4),
});
export type NpcVoice = z.infer<typeof NpcVoiceSchema>;

/** Voiced lines handed to the narrator, attributed to their speaker. */
export type VoicedLines = { speakerId: z.infer<typeof EntityIdSchema>; voice: NpcVoice };

/** Suggested actions (TRN-059), in the player's voice. */
export const SuggestionsSchema = z.object({
  suggestions: z.array(z.string().min(1).max(160)).min(1).max(6),
});

/** Consolidation output (MEM-104, MEM-107). Group and page indices refer to the prompt. */
export const ConsolidationOutputSchema = z.object({
  summaries: z.array(
    z.object({ groupIndex: z.int().nonnegative(), text: z.string().min(1).max(1000) }),
  ),
  pages: z.array(
    z.object({
      pageIndex: z.int().nonnegative(),
      sections: z
        .array(z.object({ heading: z.string().min(1).max(80), body: z.string().min(1).max(1500) }))
        .max(6),
    }),
  ),
});
```

## 7. Role recipes

What each role's prompt contains, by tier. "Truth" marks content from the truth store
that the player may not know.

| Tier | Adjudicator | Narrator | NPC voice | Extractor |
|---|---|---|---|---|
| instructions | Ruleset guide (RUL-150), stakes and complication rules, explanation rules, time guidance, tone, content settings | Narration style, tone, content settings, result and harm labels, NPC voice rules | Speak as this character only; tone, content settings | Extraction rules (MEM §4.3), importance rubric, wiki headings, relationship dimensions, ownership modes |
| world | Setting, PC sheet | Setting, PC sheet | Setting | Setting |
| scene | Place, time, public blocks | Place, time, public blocks | Place, time, public blocks | Place, time, every entity present with IDs and aliases, nearby places, items present |
| transcript | Recent | Full tier (§5) | — (replaced by witnessed observations) | Last two turns |
| state | PC statuses, gear incl. concealed; NPC statuses; **all clocks incl. GM (truth)**; completed clocks | PC statuses and gear; visible clocks | This NPC's statuses and concealed items | Statuses and clocks only under narrative ownership |
| knowledge | **Every present NPC's knowledge block (truth)**; PC knowledge and beliefs | Non-key NPCs' knowledge blocks; PC knowledge and beliefs | This NPC's knowledge block | Recent observations with handles (MEM §4.1); relationships among present characters; wiki headings |
| turn | Input; regeneration direction | Input, ruling (with full explanation), resolution and harm results, survived-fatal and death notes, voiced lines, direction | Input, outcome, visible consequences, earlier voiced lines | Input, ruling, resolution, narration |
| task | Produce a `Ruling` | Write the narration | Produce `NpcVoice` | Produce an `Extraction` |

- **CTX-070** The **adjudicator** sees the truth it needs to judge fairly (who knows
  what, NPCs' concealed items, GM clocks) and writes player-safe stakes and
  explanations (TRN-033, CON-033).
- **CTX-071** The **narrator** writes what the PC perceives. It sees non-key NPCs'
  knowledge so it can portray them, and is instructed to reveal hidden truth only
  through perceivable cues. It never sees GM clocks, other characters' concealed
  items unless revealed this turn, or key speakers' knowledge.
- **CTX-072** **Suggestions** (TRN-059) use only the PC's point of view: public blocks,
  the transcript, the PC's state and knowledge, and the latest narration.
- **CTX-073** The **transcript summary** sees only the turns being summarized and the
  setting; the **consolidator** sees only the groups and pages it is compacting.
- **CTX-074** The **world ticker** recipe is defined in `12-time-world.md` §5.4.
- **CTX-075** The adjudicator's scene tier includes the current date, time of day, and
  the time-until table (TIME-021). For a skip, the narrator is told to describe only the
  passage of time and the PC's own activity (TIME-042).
- **CTX-076** **Turn zero** (TRN-057) uses the narrator recipe with an empty transcript.
  Its `turn` tier holds the scenario's opening file (SCH-073) in place of an input, and
  the task is to open the story: set the scene and end on something the PC can act on.

## 8. Rendering the ruleset and tone

- **CTX-080** The `ruleset-guide` partial renders the campaign's ruleset for the
  adjudicator, as RUL-150 lists: stats with descriptions; the difficulty guide and
  opposed baseline; result and effect labels; a compact odds table (success-or-better
  and partial-or-better for each points value from 0 to the highest likely pool,
  computed with `odds`); harm tags and levels with examples and the incapacitating
  flag; and the stat-change pace.
- **CTX-081** The `tone` partial renders genre, tone, themes, and pacing; the
  `narration-style` partial renders perspective, tense, length, and style; the
  `content-settings` partial renders each category's intensity as a plain instruction,
  plus lines (never appear) and veils (happen off-page). Their wording is defined in
  `13-content-settings.md`.

## 9. Records

- **CTX-090** Every built prompt is stored with its model call record (ARCH-060): the
  messages, each tier's report (budget, estimate, what was trimmed, whether it is in
  the cached prefix), every retrieved memory with its reason and score parts, and the
  template files used with their layers. The context inspector (`14-ui.md`) displays
  these.

## 10. API — `types.ts`

```ts
import type {
  AppError,
  ChatMessage,
  EntityId,
  MachineConfig,
  ModelProfile,
  ModelRole,
  ReadPoint,
  Result,
  RetrievedObservation,
  TierReport,
  VoicedLines,
} from '@mythos/contracts';

export type BuiltPrompt = {
  role: ModelRole;
  messages: ChatMessage[];
  tiers: TierReport[];
  retrieved: RetrievedObservation[]; // every memory selected, for the inspector
  templates: string[]; // which template and partial files were used, with their layer
};

/** A key NPC chosen to be voiced separately this turn (CTX §6). */
export type KeySpeaker = {
  characterId: EntityId;
  why: 'flagged' | 'secret' | 'strict-mode';
};

/** A built prompt, or `context_overflow` (CTX-032) or `not_configured` (PRV-001). */
export type Built = Result<BuiltPrompt, AppError>;

/**
 * What the composition root passes to the context module (ARCH-022), so that it imports
 * neither `config` nor `providers` (ARCH-021, CTX-110).
 */
export type ContextDependencies = {
  /** The profile a role's call will use for this campaign, with its calibrated ratio (PRV-071). */
  profileFor(
    role: ModelRole,
    campaignId: string,
  ): Result<{ profile: ModelProfile; charsPerToken: number }, AppError>;
  /** Machine config's `context` section, read fresh for every prompt (PRV-004). */
  contextSettings(): MachineConfig['context'];
  /** The model-profile template folder (CTX-004, layer 2), or null if it does not exist. */
  profileTemplateDir(profileId: string): string | null;
};

/**
 * The context module's public API. Every builder reads at a read point (TRN-060) and
 * returns a complete prompt; the caller passes it to the providers module.
 */
export type ContextBuilder = {
  adjudication(point: ReadPoint, turnId: string, instruction: string | null): Promise<Built>;

  /** Decided before narration; the narrator then receives their lines (CTX-060). */
  keySpeakers(point: ReadPoint, turnId: string): Promise<KeySpeaker[]>;
  npcVoice(
    point: ReadPoint,
    turnId: string,
    speakerId: EntityId,
    earlier: VoicedLines[],
  ): Promise<Built>;
  narration(
    point: ReadPoint,
    turnId: string,
    voiced: VoicedLines[],
    instruction: string | null,
  ): Promise<Built>;

  /** Also returns the handle map for observations shown as `#n` (MEM-060). */
  extraction(
    point: ReadPoint,
    turnId: string,
  ): Promise<Result<{ prompt: BuiltPrompt; handles: Record<string, string> }, AppError>>;

  suggestions(point: ReadPoint, turnId: string): Promise<Built>;
  transcriptSummary(point: ReadPoint, turnIds: string[]): Promise<Built>;
  consolidation(
    point: ReadPoint,
    groupObservationIds: string[][],
    pageEntityIds: EntityId[],
  ): Promise<Built>;

  /** Renders a template against a campaign without calling a model (inspector preview). */
  preview(point: ReadPoint, templateName: string): Promise<Result<string, AppError>>;
};
```

- **CTX-110** The context module imports neither `config` nor `providers` (ARCH-021).
  The composition root passes it `ContextDependencies` (ARCH-022): the profile a
  role's call will use, with its calibrated ratio; machine config's `context` section;
  and the model-profile template folder. Every builder returns a `Result`, so
  `context_overflow` (CTX-032) and `not_configured` (PRV-001) are ordinary failures
  (CONV-040).

## 11. Phase delivery

| Phase | Context scope |
|---|---|
| 1 | Template engine, layers, locked content, preview; tiers and message layout; budgets and overflow; narrator recipe with instructions, world, scene, transcript, turn, and task; a scene tier with place, date and time of day, and present characters' public blocks (display names, JRN-020; appearance, GEAR-060; personality); a transcript tier of verbatim turns that rolls by chunks (CTX-041), with rolled turns simply left out until summaries arrive in phase 2; records |
| 2 | Chunk and scene summaries (CTX-040, CTX-042, CTX-043); regeneration directions |
| 3 | Adjudicator recipe and ruleset guide; state tier; suggestions |
| 4 | Knowledge tier and blocks; extractor recipe; key speakers and NPC voice; consolidator recipe |
| 7 | World ticker recipe; skip narration |
| 8 | Tone parser recipe |

## 12. Required tests

- **CTX-100** Budget allocation: fixed tiers exact; trimmable tiers by weight; spill
  order; profile caps; overflow reported with every fixed tier's size.
- **CTX-101** Prefix stability: across consecutive turns in one scene, tiers 1–4 of the
  narrator prompt are byte-identical except for appended transcript turns, until a chunk
  rolls or someone's public block changes.
- **CTX-102** Determinism: building the same prompt twice yields identical bytes.
- **CTX-103** Key speakers: flagged first, then by secret importance; uninvolved NPCs
  never; cap respected; modes `shared` and `strict`.
- **CTX-104** In the reference scene, with Varek a key speaker: the narrator prompt
  contains no observation that only Varek knows, and the NPC voice prompt for Varek
  contains no observation Varek doesn't know.
- **CTX-105** For every role, every observation in the prompt is known by a character
  whose knowledge that role may see (§7).
- **CTX-106** Template layers resolve by priority; locked content cannot be overridden;
  a missing variable fails rendering; snapshot tests cover every engine template.

## Traps

- **Strict mode does not check names inside block helpers (CTX-001, `helpers.ts`).**
  Handlebars throws on a missing `{{name}}`, but looks up a helper's parameters leniently,
  so `{{#if scene.placee}}` or `{{#each turnz}}` is silently empty. (`join` and `label`
  check their own parameters.) View models therefore carry every key, with null for
  nothing, and a test checks the narrator's has no `undefined`; a misspelled name in an
  override's `#if` still goes unnoticed.
- **A view key named like a helper calls the helper (CTX-002, `narrator-view.ts`).**
  `{{label}}` with no parameters calls the `label` helper, not the view's `label` key,
  so no view model may have a key named `join` or `label`. The content-settings
  partial's category name is `name` for this reason.
- **Each tier counts the separator before it (PRV-072, `tiers.ts`).** Tiers that share a
  message are joined by a blank line, and a tier's estimate includes the one before it.
  Left out, the tiers' estimates add up to less than the whole prompt's, and a prompt the
  budgets say fits can fail PRV-072's check.
- **The verbatim tail can move back (CTX-041, `budget.ts`).** The boundary is worked out
  afresh for every prompt from the transcript's budget, which is what the fixed tiers
  leave, and the turn tier changes size every turn. A long input can roll a chunk out
  and a short one on the next turn bring it back, changing the prefix twice. Nothing may
  assume a rolled chunk stays rolled, such as writing a chunk's summary only when it
  first rolls out; CTX-042 writes it when the chunk is complete.
- **A partial file needs its final newline (CTX-003).** Handlebars drops the line break
  after a `{{> name}}` on a line of its own, so a partial whose file does not end with a
  newline runs into the line after it.

## Decisions

| Question | Decision | Rejected and why | Decided by |
|---|---|---|---|
| 10% of what is CTX-030's margin? | Of the input budget: `floor((contextWindow − maxOutputTokens) × 0.9)`. The margin covers error in the input token estimate (PRV-072). | 10% of the whole window: a larger margin that also covers output, which `maxOutputTokens` already reserves. | owner |
| What does a `contextBudget` cap on a fixed tier do (CTX-031)? | Nothing: caps limit trimmable tiers only, so fixed tiers always get exactly what they need. | Failing with `context_overflow` when a fixed tier needs more than its cap: every call of that role would fail over a setting that cannot help. | owner |
| How does a top-level template mark where each tier starts (CTX-003)? | A line `<!-- tier: <name> -->` starts each tier of the role's recipe, once each and in tier order. Code splits the rendered text at these lines and trims each tier. A missing, repeated, out-of-order, or unknown marker fails with `validation_failed`, naming the file and its layer. | One file per tier: twelve files per role, and a layer could not change two tiers in one place. Code writing every tier but the instructions: the world, scene, and turn tiers' wording could not be changed. | owner |
| How is room kept for the format instruction (CTX-030, PRV-072)? | The budget takes `reservedTokens`. It comes off the input budget before the tiers share it, has a line of its own in a `context_overflow` message, and counts in the PRV-072 check. The narrator reserves 0, because `streamText` adds no format instruction. Each structured role's reservation arrives with its recipe (Open). | A per-method reservation written now: no structured role has a recipe until phase 3. | owner |
| What happens when the scene is still over its budget after its last trim (CTX-034)? | Its fully trimmed form is kept whole, like a fixed tier, and the transcript makes up the difference. If the fixed tiers and that scene still do not fit, `context_overflow` lists the scene with the fixed tiers. | Dropping uninvolved characters from the scene: the narrator would no longer know who is there. | owner |
| What of text before a top-level template's first tier marker (CTX-003)? | It fails like a bad marker, because it would belong to no tier. A note for the template's reader goes in a Handlebars comment, `{{!-- … --}}`, which renders nothing. | Adding it to the first tier: text would move silently from where its author put it. | Claude (ruling) |
| What does `{{> name}}` resolve to, and how does a prompt name its files (CTX-003, CTX-090)? | `partials/<name>.md`, found in the same six layers. A name is lowercase words, digits, and hyphens, with `/` between folders. `BuiltPrompt.templates` lists each file used as `<layer>:<path>`, sorted with `cmp`, the layers named `campaign`, `model-profile`, `tone-profile`, `pack`, `ruleset`, and `engine`. | A partial anywhere in a layer's folder: `{{> tone}}` could mean two files. | Claude (ruling) |
| What happens when a template fails (CTX-001, CTX-106)? | A missing variable, a syntax error, an unknown helper or partial, a partial that includes itself, a partial block or inline partial, or a bad tier marker is `validation_failed`, naming the file it is in and that file's layer. When every file the prompt used is the engine's, it throws instead: the shipped templates are broken (CONV-041). | Falling back to the engine's file: the player's override would stop working without a word. | Claude (ruling) |
| What keys does `label` take (CTX-002)? | `result.<tier>` and `effect.<level>`, and `harm.<n>` from 1 to one past the ruleset's last level, which is its `fatalName`. Any other key fails rendering. | Labels as view-model data: every role's view model would carry the same ruleset labels. | Claude (ruling) |
| What does the narrator's scene tier hold of the place? | Its display name and its runtime `description`, never its canon Markdown, which is truth (SCH-021). | Its common knowledge (JRN-031): the narrator would read lore as something the PC sees in the room. | Claude (ruling) |
| Who is "involved" in phase 1 (CTX-034, CSET-042)? | The PC, and every character the input names by the name the PC knows them by, with or without a leading article, present or not. Phase 1 has no ruling to name targets, and no voiced lines (CTX-060). | Only present characters: a minor the player names while elsewhere would not tighten the prompt. | Claude (ruling) |
| How does the scene trim (CTX-034)? | One step at a time: each uninvolved character's personality, in listing order, then each one's appearance cut to its first sentence, its "one line". A step that would remove nothing is skipped. Each trimmed item names its entity ID, such as `personality of npc.odette`. | Trimming all personalities at once: the scene would lose more than it needs to fit. | Claude (ruling) |
| What do a phase-1 prompt's tiers and reports hold (CTX-010, CTX-090)? | Only the recipe's tiers. The narrator's state and knowledge tiers arrive with their content (09-context §11), so they have no report, and the scene and transcript share the budget by their own weights, 15 and 45. A tier with no content, such as the transcript at turn zero, gets no message and reports an estimate of 0 outside the cached prefix. | Empty state and knowledge tiers with weights: their share would only spill to the others. | Claude (ruling) |
| What may `preview` render (CTX-008)? | A template path matching `^[a-z0-9-]+(/[a-z0-9-]+)*\.md$`, so it never reaches outside a layer's folder. In phase 1 it builds the narrator prompt at the point, through the same budgets, and shows each message under a line naming its role and tiers, for `narrator.md` or any file that prompt used. Any other file is `not_found`. | Rendering a partial alone: it would have no context to render against. | Claude (ruling) |

## Open

- **Structured roles' format instructions are not reserved yet (CTX-030, PRV-050 step
  3).** The structured-output pipeline adds its format instruction after the context
  module has budgeted the prompt, as a system message after the leading system messages,
  between the `world` message and the `scene` message of CTX-010's layout. The budget
  reserves `reservedTokens` for it (Decisions), and the narrator reserves 0. Phase 3,
  which brings the first structured recipe, computes the reservation for each structured
  role from its method: one line for `json-schema` and `tool-call`, and for
  `prompt-only` the whole JSON Schema and an example, about 8,500 characters for the
  ruling (roughly 2,430 tokens). A retry's failed answer and its problem list are still
  unreserved.
- **Characters are listed by ID, not by when they joined (CTX-012).** In phase 1 everyone
  present was there when the scene started, so they tie. Once characters can arrive
  mid-scene (extraction, phase 4), the order they joined must be tracked.
- **The transcript holds inputs and narration only (CTX-040).** Roll lines arrive with
  rolls in phase 3, and OOC turns are not left out after `oocTurnsKept` (TRN-020),
  because phase 1 accepts only in-character input. Rolled-out turns are simply left out
  until chunk summaries arrive in phase 2, and the inspector lists them as trimmed.
- **The view model is not kept (CTX-006).** Neither `BuiltPrompt` nor the model call
  record has a field for it, so the inspector can show only the rendered prompt.
- **Folding at a read point is written twice (TRN-060).** `context/read.ts` and
  `turn/campaign-view.ts` each read a point's sets, order them with `orderSets`, and fold
  them; P1-T19's read point will be a third. One helper would keep them the same.
