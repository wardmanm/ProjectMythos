---
doc: glossary
title: Mythos — Glossary
status: draft
schemaVersion: 1
---

# Glossary

> **For Claude:** these are the only names for these concepts. Use them in code
> identifiers, comments, UI text, and docs. The **Avoid** column lists terms that
> MUST NOT be used for the concept, because they are ambiguous or mean something else
> here. If you need a concept that isn't listed, raise it under the task's Pending
> decisions; do not coin one.

Terms in *italics* inside definitions are defined elsewhere in this glossary.

## Roles and actors

| Term | Definition | Avoid |
|---|---|---|
| **Player** | The human using the app. | user (except in auth/UI code) |
| **Player character (PC)** | The single character the player controls. | hero, avatar |
| **NPC** | Any character other than the PC. | mob, actor |
| **Entity** | Anything with identity the engine tracks: a character, place, faction, or item. | object, thing, node |
| **GM** | The model-driven game master: adjudicates and narrates. | DM, AI, bot, narrator (see below) |
| **Engine** | The TypeScript code. Owns rules, state, time, dice, memory, and validation. | backend (when meaning game logic), system |
| **Narrator** | The *model role* that writes narration. One part of the GM. | GM (when meaning only narration) |

## Content and configuration

| Term | Definition | Avoid |
|---|---|---|
| **Content pack** | A folder of JSON and Markdown defining playable content. Portable and git-friendly. | module, mod, DLC |
| **Canon** | Authored content in a content pack. Never modified at runtime. | lore, base data |
| **Setting** | The world definition: places, factions, NPCs, items, calendar, slot schema. | world (in code), universe |
| **Setting preset** | A reusable, saved setting. | template (reserved; see below) |
| **Library** | Reusable definitions outside any pack: the *user library* (player-saved) and the *built-in library* (shipped). Searched after the pack. | presets folder |
| **Definition** | A reusable content file identified by a prefixed ID: calendar, slot schema, tone profile, ruleset, scenario, setting. | config (ambiguous) |
| **Scenario** | A starting situation within a setting: start date, place, present NPCs, opening, PC options. | adventure, module, quest |
| **History entry** | An authored pre-campaign event or claim, converted into an observation at campaign creation. | backstory (in code), lore |
| **Personality** | A character's short, always-in-context behavior summary. Longer detail goes in canon Markdown. | bio, description |
| **Tone profile** | Genre, tone, style, lethality, pacing, content settings, and art style. Saved and reusable. | genre file, vibe |
| **Ruleset** | A complete game system as data: stats, dice method, results, effect, harm, resistance, healing, lethality, clocks, relationships, and turn options. | system, rules file |
| **Building block** | A fixed piece of engine logic that rulesets parameterize (e.g. the `sum` dice method). New building blocks are code changes; new rulesets never are. | module, plugin |
| **Fixture** | A normative data file in `spec/fixtures/`: the built-in library and the reference pack, copied into the repo as-is, and test-only data that tests read in place (OVR-030). | sample, mock data |
| **Template** | An editable Markdown prompt file with placeholders. Used only for prompts. | prompt string |
| **Calendar definition** | Data describing a calendar: months, lengths, weekdays, hours per day, intercalary days. | date format |
| **Slot schema** | The equipment slots and layers defined by a tone profile or setting. | equipment layout |
| **Machine config** | Per-machine settings: providers, model roles, profiles, bind address, PIN, data directory. Never exported. | settings (ambiguous), env |
| **Campaign** | One playthrough: a snapshot of content plus its full history. One folder containing a SQLite database and its assets. | save, game, run |
| **Content snapshot** | The copy of canon, tone profile, ruleset, and templates stored inside a campaign at creation. | — |

## Play structure

| Term | Definition | Avoid |
|---|---|---|
| **Turn** | One player input and everything the engine and GM do in response. The unit of editing and rewind. | message, exchange, round |
| **Scene** | A continuous stretch of play in one place and time. Changes on location change or time skip. | chapter, session |
| **In-character input (IC)** | Player input that is the PC's speech or action. | prompt |
| **Out-of-character input (OOC)** | Player input addressed to the GM, not the fiction (corrections, requests, skips). | meta, system message |
| **Suggested action** | A GM-offered option the player can pick instead of typing. Enabled per ruleset. | choice button |
| **Branch** | A line of history: a named pointer to a turn (its *head*) and all its ancestors. | timeline (in code), save slot |
| **Head** | The turn a branch points to; where new turns are added. | tip, latest |
| **Ancestry** | A turn and every turn on the path back to the root. A branch's history is its head's ancestry. | lineage, path |
| **Shared turn** | A turn in the ancestry of more than one branch (archived branches included). Never edited in place. | common turn |
| **Copy-on-write** | Copying a shared turn and its later turns on the current branch before editing, so other branches are unaffected. | clone, duplicate |
| **Archived branch** | A branch hidden by default; created automatically by rewrite and rewind to preserve the discarded turns. | deleted branch, trash |
| **Fork** | Creating a new branch from any earlier turn. | copy, clone |
| **Bookmark** | A named reference to a turn. | save |
| **Rewind** | Moving a branch's head back to an earlier turn; later turns are archived. A rewrite without an edit. | undo, revert |
| **History mode** | The choice required when editing a non-head turn: *rewrite* or *retcon*. | edit mode |
| **Rewrite** | Editing an earlier turn and discarding all turns after it on that branch. | undo |
| **Retcon** | Editing an earlier turn and keeping later turns, whose state is replayed on top of the edit. | — |

## Turn pipeline

| Term | Definition | Avoid |
|---|---|---|
| **Adjudication** | Step 1: a structured model call deciding whether a roll is needed, or ruling directly. | judgment, decision |
| **Ruling** | The adjudication's output: outcome or roll request, stakes, and reasoning. | verdict |
| **Resolution** | Step 2: engine-only processing of a ruling, including any dice. | — |
| **Resolution draft** | The pending outcome of a turn (rolls, outcome, consequences) shown to the player before resolution commits. Not a commit. | preview, pending roll |
| **Narration** | Step 3: streamed prose describing the resolved outcome. | response, output, reply |
| **Extraction** | Step 4: background structured model call converting a turn into *commits*. | summarization, parsing |
| **Override** | Any player action that replaces a model output or engine result: a ruling, a roll, narration, state, a memory. Always free. | veto (fine in UI text only) |
| **Explanation** | The GM's stated reasoning for a ruling. Shown per the *explanation level*. | rationale |
| **Explanation level** | `off`, `player-safe` (only player-known information), or `full` (spoilers). | — |

## Rules

| Term | Definition | Avoid |
|---|---|---|
| **Stat** | A rated attribute defined by the ruleset. The standard ruleset has five, rated 1–5: Strength (STR), Endurance (END), Dexterity (DEX), Intelligence (INT), Charisma (CHA). | attribute, ability score, skill |
| **Roll** | Rolling a *dice pool* of d6. Only when the GM calls for it. | check, save |
| **Points** | What a roll is built from: stat rating + difficulty + item points − harm points. One point is a die in a pool method, or `pointValue` added in the sum method. | modifier, bonus |
| **Dice method** | How a ruleset rolls and reads dice: `pool-highest`, `pool-count`, or `sum`. | roll type, system |
| **Dice pool** | In a pool method, the dice rolled: one per point. At 0 or fewer, the ruleset's empty-pool rule applies. | — |
| **Band** | A ruleset rule mapping a read value at or above a minimum to a result. | threshold, DC |
| **Difficulty** | The GM's adjustment, in points, from the situation only (standard: −3…+3; e.g. +2 vs a child, −2 vs a professional). Never accounts for the actor's harm or gear. | DC, target number |
| **Dice card** | The expanded view of a roll: points breakdown, dice, result, effect, stakes, harm steps, with reroll and override controls. | roll widget |
| **Roll line** | The one-line summary of a roll in the story; expands to the dice card. | — |
| **Theme** | A campaign's look: palettes, fonts, and ornaments (`theme.<slug>`). Never changes layout or behavior. | skin |
| **Input dock** | The input area: mode switch (in or out of character), text, send, skip. | chat box |
| **Side panel** | The Character, Scene, and Journal tabs beside the story (sheets on phones). | sidebar (fine in code) |
| **Device preferences** | Per-device settings kept in the browser: text size, theme override, light or dark, motion, drafts, GM mode. | user settings |
| **Result** | The outcome tier of a roll: `critical`, `success`, `partial`, or `failure`. Fixed tiers; the ruleset maps dice to them and names them (standard: two 6s, a 6, a 4–5, 1–3). | — |
| **Effect** | How much a success accomplishes: `limited`, `standard`, or `great`. Starts from the stat's rating, adjusted by the situation, lesser harm, criticals, and reduced-effect costs. | quality, degree |
| **Consequence** | A cost the GM inflicts: `reduced-effect`, `complication`, `lost-opportunity`, `worse-position`, or `harm`. | penalty, damage |
| **Planned consequence** | One item in a ruling's outcome: a consequence, or something achieved (`progress`, `treatment`). | effect (reserved) |
| **Stakes** | A roll ruling's three lists, set before rolling: what success achieves, and the costs of a partial and of failure. | odds, DC |
| **Progress** | A planned consequence for something the actor achieves; may tick a clock. | success effect |
| **Treatment** | A planned consequence that treats harm: marks it treated and lowers it by effect. | healing (that is time-based) |
| **Harm** | A named, lasting status from injury or strain, at a *harm level*. There are no hit points. | damage, HP, wound (in code) |
| **Harm level** | A severity defined by the ruleset, 1 = least severe; one above the last is fatal. Standard: 1 lesser, 2 moderate, 3 severe, 4 fatal. | — |
| **Capacity** | How many harms of each level a character can hold (standard: 2, 2, 1). | slots (reserved for gear) |
| **Overflow** | Harm moving up a level because its level is full. | spillover |
| **Hinder** | A harm hinders a stat when one of its tags lists that stat; it then penalizes rolls with that stat. | affect, debuff |
| **Armor** | An item with a harm-reduction bonus; lowers matching harm one level, limited uses per scene. | protection |
| **Mention** | An entity an observation refers to without it acting or witnessing (`mentionedIds`). | reference |
| **Mitigation** | Harm lowered by armor or resistance before placement; recorded as `harm.mitigate`. | reduction (in code) |
| **Status** | Any named condition on a character, including harm. Has tags (physical, mental, social). May be *permanent* (never heals) or, for harm, *treated* (heals faster). | effect (reserved), buff, debuff |
| **Resistance roll** | An automatic roll that lowers incoming harm; the stat is the harm tag's `resistStat` (standard: END for physical and mental, CHA for social). | save |
| **Clock** | A segmented progress tracker owned by the engine (e.g. guard alertness 2/6). | timer, meter, bar |
| **Stat-change clock** | A clock that changes a stat when filled; driven by narrative (training, neglect). | XP |
| **Lethality** | Ruleset setting, separately for the PC and NPCs: `lethal` (fatal harm kills), `heroic` (survives with a permanent condition), or `none` (capped at severe). | death mode |

## State and history

| Term | Definition | Avoid |
|---|---|---|
| **World state** | Current mutable facts: locations, stats, statuses, inventory, clocks, flags. | game state, save data |
| **Authoritative field** | A world-state field that changes only through validated engine operations. | locked field |
| **Narrative field** | A world-state field updated from extraction without strict validation. | loose field |
| **Commit** | An atomic, turn-scoped change to stored data. All derived data is commits. | patch, mutation, transaction (in docs) |
| **Commit set** | A group of commits from one stage of one turn, applied atomically. Edits create a new set that supersedes the old one. | batch, changeset |
| **Stage** | The pipeline step or background process that produced a commit set (setup, input, adjudication, resolution, narration, extraction, world-tick, consolidation, player-edit). | phase (reserved for project phases), step (in code) |
| **Active** | A commit set that no later set supersedes. Only active sets affect state. | current, live |
| **Stale** | An active set whose `basedOnSetIds` includes a set that is no longer active. Derived, never stored. | dirty, outdated |
| **Version** | Any set of a stage on a turn, active or superseded. Older versions can be restored. | revision, history entry |
| **Projection** | Data derived from the event log. Either a *row projection* (rows filtered by branch and point) or *folded state* (computed by replaying commits). Never written directly. | cache (reserved for snapshots), view |
| **Folded state** | World state, relationships, wiki pages, notes, and beliefs, computed by folding commits in order. | game state (ambiguous) |
| **Point (asOf)** | Where in a branch a read happens: the head during play, or a specific turn and stage when regenerating history. | timestamp, version |
| **Replay conflict** | A commit skipped during replay after a retcon because it no longer validates. Shown to the player. | merge conflict, error |
| **Semantic validation** | Checks beyond schema shape: references exist, invariants hold, stage is allowed. Runs in `core` before any set applies. | business rules |
| **Invariant** | A cross-field rule that must always hold but is not expressed in the Zod schema. | constraint (ambiguous) |
| **Event log** | The ordered list of commits. State is derived by replaying it. | history table |
| **Snapshot** | Folded state stored at a turn to speed up replay. A cache. | checkpoint, save |

## Memory and knowledge

| Term | Definition | Avoid |
|---|---|---|
| **Truth store** | What actually happened. Hidden from the player except in *GM mode*. | canon (that's authored), database |
| **Observation** | One thing that happened, written as its witnesses could perceive it: who did what, where, when, with *witnesses*. The unit of memory. | fact, memory (in code), event |
| **Private observation** | An observation of a character's inner state (fear, intent), witnessed only by that character. | thought, secret (in code) |
| **Witness** | A living character present at the scene who directly perceived an observation. | participant (when meaning perceiver) |
| **Knower** | The character whose knowledge a query or retrieval is scoped to. | owner, viewer |
| **Source** | Who conveyed secondhand information. Enables lies and rumors. | origin |
| **Knowledge** | The set of observations and claims an entity has access to. | awareness |
| **Claim** | Information asserted by a source, which may be false. Stored as "X told Y that Z", never as Z; hearing it never grants knowledge of the truth it concerns. | fact, rumor (in code) |
| **Knowledge transfer** | An observation recording that information passed between entities. | sharing |
| **Rumor propagation** | A claim reaching characters secondhand during *world ticks*; they know it `via: 'rumor'`, rendered as hearsay. | gossip |
| **Entity wiki page** | A living page per entity with a canon section and a learned section. Truth-level. | profile, card, bio |
| **Relationship** | A directed record from one character to another: dimensions (e.g. trust, affection) plus links to defining observations. | bond, reputation |
| **Importance** | A 1–10 score on an observation, used in retrieval ranking and consolidation. | priority, weight |
| **Retrieval** | Selecting one knower's observations for a prompt: pinned, then scored, within a token budget. | lookup, RAG (in code) |
| **Focus entity** | An entity present in the scene or mentioned in the input; boosts retrieval scores. | target |
| **Pinned memory** | A memory always included before scoring: the most recent moments with the PC, and a relationship's key observations. | sticky |
| **Handle** | A prompt-local label (`#12`) for an existing observation, so models never copy UUIDs. | id, pointer |
| **Consolidation** | Background compression of old, minor observations, grouped by exactly who knows them, into summary observations. Originals are kept. | pruning, deletion |
| **Player journal** | The player-facing wiki built only from the PC's knowledge. | wiki (alone), codex |
| **Display name** | The name a knower uses for an entity: the latest learned name, else a descriptor until introduced. Never reveals a true name early. | nickname (in code) |
| **Known entity** | An entity appearing in any observation a knower knows (as actor, witness, mention, place, or claim party). | discovered |
| **Common knowledge** | The `## Common knowledge` section of an entity's canon: lore the player may see once the PC knows the entity. | public lore |
| **Correction** | A player amendment to an observation the PC witnessed, or a claim told to the PC, fixing a mis-extraction. | edit (ambiguous) |
| **Chronicle** | The journal's timeline of every observation the knower knows. | log, history |
| **View as** | GM mode's journal for any character, built from that character's knowledge. | impersonate |
| **Note** | Free text the player adds to the journal. | comment |
| **Belief** | A player-written statement of what the PC thinks is true. Fed to the GM; never changes truth. | fact, theory |
| **GM mode** | A per-device mode that shows and allows editing of hidden truth, marked by a frame around the screen. | admin mode, debug mode |

## Time and world

| Term | Definition | Avoid |
|---|---|---|
| **Game time** | Integer minutes since the campaign epoch. The only internal time value. | timestamp (reserved for real time) |
| **Time skip** | A single advance of at least the setting's `sceneBreakMinutes` (default 4 hours): sleep, travel, "a month passes". Starts a new scene. | fast-forward |
| **Epoch** | The calendar date at game time 0, set by the setting. | start date |
| **Time-until table** | Minutes until each time of day, computed by the engine for the adjudicator, so skips need no date math. | — |
| **Tick boundary** | A multiple of `worldTickMinutes` from the epoch; crossing one schedules a world tick. | — |
| **Tick period** | The span one world tick simulates: *fine* (one tick length) or *coarse* (a day, week, month, season, or year). | — |
| **Actor** | An NPC or faction simulated in a world tick: has goals, owns a running clock, or was recently with the PC. | agent |
| **Off-screen news** | What the PC learned during a skip's world ticks, shown under the skip's narration. | recap |
| **World tick** | Background processing of off-screen NPCs each time game time crosses a tick boundary. Length set per setting. | tick (alone), turn |
| **Coarse tick** | A world tick covering a longer span (see *tick period*), used during long time skips. | — |
| **Active NPC** | An NPC eligible for world ticks: has goals, running clocks, or recent involvement. | — |

## Gear

| Term | Definition | Avoid |
|---|---|---|
| **Item** | An entity that can be carried, worn, or held. | object, loot |
| **Slot** | A body location defined by the slot schema (e.g. torso, feet). | equipment slot (fine in UI) |
| **Layer** | An ordered position within a slot, marked visible or concealed. | depth |
| **Appearance** | Generated description of a character: physical description plus visible layers only. | look, description (alone) |
| **Concealed** | An item not visible to others; enters prompts only when relevant. | hidden (in code) |
| **Carrying mode** | Ruleset choice: `encumbrance` (weight limit) or `containers` (capacity by container). | inventory mode |
| **Container** | An item that holds other items, with a capacity in size points and a largest item size (a pocket, a backpack). | bag (generic) |
| **Size points** | Space an item of a given size takes in a container (standard: tiny 1 … huge 16). | slots (reserved) |
| **Possessor** | The character who has an item on them, following containers outward. | holder (ambiguous) |
| **Owner** | Who an item belongs to; may differ from its possessor (a stolen locket). | possessor |
| **Stack** | An item with quantity above 1: identical units, per-unit size and weight. | pile |
| **Load** | Total weight a character carries in encumbrance mode. | burden |
| **Covers** | Slots a worn item hides, e.g. a cloak covering the neck. | overlaps |

## Models and infrastructure

| Term | Definition | Avoid |
|---|---|---|
| **Provider** | An adapter to a model API (OpenAI-compatible, Anthropic, image APIs, ComfyUI, speech APIs). | backend, service |
| **Model role** | A job a model performs: `narrator`, `adjudicator`, `npc-voice`, `extractor`, `consolidator`, `embedder`. | agent |
| **Model profile** | Per-model settings: context size, structured-output method, tool support, context budget. | preset |
| **Structured output** | Model output that must validate against a Zod schema. | JSON mode (that's one method) |
| **Context budget** | Token allocation per *context tier* for a model profile. | — |
| **Context tier** | One of eight ordered sections of a prompt: instructions, world, scene, transcript, state, knowledge, turn, task. | block, chunk |
| **Cache breakpoint** | The end of a prompt's stable prefix, after which content changes turn to turn; lets runtimes reuse cached work. | — |
| **Template layer** | A source of templates: campaign, model profile, tone profile, pack, ruleset, or engine, in that priority. | theme |
| **Locked content** | Prompt content no template layer can override: the hard floor and output-format instructions. | — |
| **View model** | The typed data a template renders, built in code; templates never compute. | context object |
| **Public block** | What anyone present can see of a character: name, appearance, personality, visible statuses. | profile |
| **Knowledge block** | One character's own relationships, wiki sections, and retrieved memories, labeled as theirs. | brief (alone) |
| **Key speaker** | An involved NPC voiced by a separate call this turn: flagged `keyNpc`, or holding a relevant secret. | main character |
| **Voiced lines** | A key speaker's dialogue and visible actions, which the narrator uses as written. | script |
| **Transcript chunk** | A fixed run of turns (default 8) that rolls into a summary as a unit, keeping the prompt prefix stable. | window |
| **Prefix-stable** | Prompt ordering where unchanging tiers come first so the runtime can reuse its cache. | — |
| **Job queue** | The engine's single scheduler for model and media jobs, with priorities. | task queue |
| **Device** | A physical compute resource jobs run on; jobs on the same device never run concurrently. | GPU (in config) |
| **Probe** | A settings action that tests a model profile: reachability, which structured-output methods work, and speed. | test, ping |
| **Context inspector** | UI showing exactly what was sent to and returned from each model call for a turn. | debug panel |

## Content settings

| Term | Definition | Avoid |
|---|---|---|
| **Content category** | A class of content with its own intensity: violence, gore, sexual content, language, disturbing themes. | rating |
| **Intensity level** | `off`, `fade-to-black`, `moderate`, `explicit`. | — |
| **Line** | Content that must never appear. | ban |
| **Veil** | Content that may occur but is not depicted on-page. | — |
| **Hard floor** | The one non-configurable rule: never sexual content involving a minor. Appended by code to every fiction prompt. | — |
| **Automatic tightening** | Rendering `sexual: off` and repeating the floor whenever a minor is present or involved. | — |
| **X control** | The "I don't want this" control on any output: regenerate without it, and/or add a line or veil. | X-card (fine in UI) |

## Media and voice (later phases)

| Term | Definition | Avoid |
|---|---|---|
| **Asset** | A stored media file (image or audio) belonging to a campaign, linked to an entity or scene. | attachment, upload |
| **Asset version** | One generation of an asset. One version is active; others are retained. | revision |
| **Workflow mapping** | A file mapping ComfyUI workflow node inputs to engine parameters. | — |
| **Media profile** | A machine's image, speech-output, or speech-input model and its settings. | — |
| **Illustrator** | The optional model role that writes image prompts from the PC's view of a subject. | artist |
| **Content negatives** | Negative-prompt terms the engine adds to every image from the content settings and the hard floor. | filters |
| **Speech mode** | Per campaign: off, narrator (one voice), or character voices (narration split by speaker). | TTS mode |
| **Speech segmenter** | The model role that splits narration by speaker, reproducing it exactly. | — |
| **Voice assignment** | A machine's choice of voice ID for the narrator or a character, kept per speech profile. | voice mapping |
| **Speech output** | Converting narration or NPC dialogue to audio (text-to-speech). | TTS (fine in provider names), voiceover |
| **Speech input** | Converting the player's spoken audio into input text (speech-to-text). | STT (fine in provider names), dictation |
| **Voice profile** | Per-character speech output settings: provider, voice ID, and style parameters. The narrator has one too. | voice (alone), accent |
