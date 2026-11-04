---
doc: 00-overview
title: Mythos — Project Overview
status: draft
schemaVersion: 1
requirementPrefix: OVR
---

# Mythos — Project Overview

> **For Claude:** read this document and `glossary.md` before any task. Every other spec
> document assumes both. Use glossary terms exactly; do not invent synonyms.

## 1. What Mythos is

Mythos is a single-player, AI-run tabletop-style roleplaying game that runs locally
in a browser. A language model acts as the **GM**; the **engine** (TypeScript code)
owns rules, state, time, and memory. Everything about a game — its world, characters,
items, rules toggles, tone, calendar, equipment slots, and even the prompts sent to
the model — is defined in editable JSON and Markdown files.

The defining feature is **memory with knowledge boundaries**. Characters remember
what they personally witnessed or were told, by whom, and when. When the player meets
an NPC, the engine rapidly retrieves that NPC's personality, current state, relationship
with the player, and shared history — and nothing the NPC could not know.

## 2. Design pillars

These are ranked. When two pillars conflict, the higher one wins.

1. **Player authority.** The player can veto, edit, regenerate, or rewind *any* output
   — rulings, rolls, narration, extracted memories, state, images. Nothing the model
   produces is final until the player lets it stand.
2. **Fiction first.** Most outcomes are decided by the GM from the fiction: what the
   player actually says and does, weighed against who the characters are. Dice are
   reserved for risky, uncertain moments (combat, desperate maneuvers). The feel is
   closer to *Blades in the Dark* than to *D&D*.
3. **Consistency through the engine.** The model narrates; the engine remembers. State,
   memory, and time live in structured storage, never only in the transcript.
4. **Knowledge boundaries.** No character — including the player character — knows
   anything they did not witness, were told, or could reasonably infer.
5. **Configurable, not hardcoded.** The entire rules system (stats, dice, results,
   effect, harm, healing, resistance, lethality, clocks), plus genre, tone, content
   intensity, slots, carrying, calendar, tick length, prompts, and model routing, are
   data.
6. **Local-first, model-agnostic.** Runs fully offline on local models; cloud models
   are optional and interchangeable per role.
7. **Human-maintainable.** Boring, explicit, well-typed code that the project owner can
   read and change without an agent. Clever code is a defect.

## 3. Platform and deployment

- **OVR-001** The application MUST run on Windows 10/11 (x64) and macOS (Apple Silicon)
  with identical behavior.
- **OVR-002** The application runs as one Node.js server process that serves the built
  React client and the API on a single port.
- **OVR-003** The server MUST be reachable from other devices on the local network
  (phone, tablet, other PCs). The bind address is configurable.
- **OVR-004** An optional PIN lock protects LAN access. It is convenience-level
  protection, not a security boundary. Localhost may be exempted.
- **OVR-005** The client MUST be usable on desktop and on touch devices down to phone
  width.
- **OVR-006** Configuration is split into **machine config** (per machine, never
  committed or exported) and **campaign/content data** (portable between machines).

## 4. Technology stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict) everywhere |
| Client | React + Vite, shadcn/ui + Tailwind, TanStack Query, Zustand |
| Server | Node.js 26 LTS + Fastify, run with `tsx` (no build step) |
| Validation | Zod (single source of truth for all data shapes) |
| Storage | SQLite through Node's built-in `node:sqlite` (one database per campaign); embeddings stored in it and compared in-process (MEM-083) |
| Streaming | Server-Sent Events (server→client); HTTP POST (client→server) |
| Testing | Vitest; mock model provider with recorded fixtures |
| Repo | Monorepo (see `01-architecture.md`) |

Rationale for non-obvious choices lives in `decisions/`.

## 5. System summary

Each system has its own spec document. This is the map, not the detail.

| System | What it does | Doc |
|---|---|---|
| Content | JSON/Markdown content packs: canon, settings, tone profiles, rulesets, templates | `04-content-schemas.md` |
| Providers | Model roles, model profiles, provider adapters, job queue | `05-providers.md` |
| Turn engine | Turns, commits, edit/regenerate/rewind, branches | `06-turn-engine.md` |
| Rules | Stats, d6 pool, effect, consequences, harm, clocks | `07-rules.md` |
| Memory | Truth store, observations, entity wiki, relationships, retrieval | `08-memory.md` |
| Context | Budget allocation and prompt assembly | `09-context.md` |
| Journal | The player's knowledge, notes, and beliefs | `10-journal.md` |
| Gear | Slots, layers, appearance, carrying | `11-gear.md` |
| Time & world | Calendar, time skips, world ticks, off-screen NPCs | `12-time-world.md` |
| Content settings | Tone profiles, intensity levels, lines/veils, hard floor | `13-content-settings.md` |
| UI | Screens, controls, streaming, context inspector | `14-ui.md` |
| Media | Image and speech providers, voice profiles, assets, versions (later phases) | `15-media.md` |

### 5.1 The turn pipeline (summary)

Every player input goes through four steps. Details in `06-turn-engine.md`.

1. **Adjudicate** — a structured model call. The GM decides whether a roll is needed
   (and with which stat and difficulty) or rules on the outcome directly from the
   fiction, and states its reasoning.
2. **Resolve** — pure engine code. Dice are rolled if required. The player may accept,
   reroll, or override the ruling or the result.
3. **Narrate** — a streamed plain-text model call that describes the resolved outcome.
   The narrator never decides mechanics.
4. **Extract** — a background structured model call that turns what happened into
   commits: observations, state changes, wiki patches, relationship changes, knowledge
   transfers. Commits for a turn apply atomically or not at all.

## 6. Non-goals

These are explicitly out of scope. Tasks MUST NOT build toward them.

- Multiplayer or shared sessions of any kind.
- User accounts, roles, or real security (the PIN is the whole auth story).
- Hosting on the public internet.
- Simulation-heavy rules: skill lists, d20 checks for routine actions, initiative
  tracking, grid or map combat.
- Native mobile apps or an Electron/desktop wrapper. The browser is the client.
- Training or fine-tuning models.
- A general-purpose chatbot. Every feature serves play.

## 7. Phases

Each phase ends in something playable and testable. Only the current phase has
detailed task files; later phases are refined when reached.

| # | Phase | Deliverable |
|---|---|---|
| 1 | Foundation | Chat with a model as GM using JSON-loaded content, local or cloud, on Windows and Mac |
| 2 | Turn engine | Freeform play with edit, regenerate, rewind, retcon, and forking |
| 3 | State & rules | Rolls, effect, consequences, harm, clocks, overrides, editable state panel |
| 4 | Memory | NPCs remember accurately and respect knowledge boundaries; context inspector |
| 5 | Journal | Player-scoped wiki with editable notes and beliefs; GM mode |
| 6 | Gear | Slots, layers, appearance, concealment, carrying modes, item bonuses |
| 7 | Time & world | Calendar, time skips, world ticks, rumors, consolidation, healing, stat change |
| 8 | Authoring | Tone/genre builder, content settings UI, content editors |
| 9 | Media | Image generation (ComfyUI and cloud), portraits, versioned assets |
| 10 | Voice | Speech output for narration and NPC dialogue with per-character voices; optional speech input |

**OVR-010** Phase 1 MUST reserve extension points for later phases where retrofitting
would be costly: asset storage in the campaign file (images and audio), device-aware
job queue, a media field on entities, a voice profile field on characters, and
turn-scoped commits.

**OVR-011** Speech input requires microphone access, which browsers only grant on
secure contexts (HTTPS or localhost). Phase 10 MUST therefore include optional HTTPS
with a self-signed certificate, configured in machine config. Speech input without
HTTPS works only on the host machine; the UI MUST explain this rather than fail
silently. Speech output has no such requirement.

## 8. How to read and maintain the spec

### 8.1 Spec-first rule

- **OVR-020** The spec is the source of truth, and it stays true. When implementation
  shows a requirement is wrong, incomplete, or in conflict with another, the
  requirement is amended in the same branch as the code (CONV-133, §8.7). A decision
  that crosses documents is also recorded as an ADR in `decisions/` (OVR-036).
- **OVR-021** Code that implements no requirement, and behavioral requirements with no
  test, are both defects. The docs check finds the second kind for done tasks
  (OVR-038).

### 8.2 Requirement language

- **MUST / MUST NOT** — mandatory.
- **SHOULD / SHOULD NOT** — expected unless there is a documented reason.
- **MAY** — optional.

### 8.3 Requirement IDs

Every requirement has an ID of the form `PREFIX-NNN`. IDs are never reused or
renumbered; retired requirements stay in place, marked `(retired, …)` (OVR-034).
Because IDs are permanent, a requirement added later keeps its new number even when it
sits in an earlier section, so IDs read in order within a section but not always
across sections. Tests and code comments cite the IDs they implement, e.g.
`// Implements RUL-014`.

| Prefix | Document |
|---|---|
| OVR | 00-overview |
| ARCH | 01-architecture |
| CONV | 02-conventions |
| CON | 03-contracts |
| SCH | 04-content-schemas |
| PRV | 05-providers |
| TRN | 06-turn-engine |
| RUL | 07-rules |
| MEM | 08-memory |
| CTX | 09-context |
| JRN | 10-journal |
| GEAR | 11-gear |
| TIME | 12-time-world |
| CSET | 13-content-settings |
| UI | 14-ui |
| MED | 15-media |

### 8.4 Document layout

```
/spec
  00-overview.md
  glossary.md
  01-architecture.md … 15-media.md
  decisions/        ADR-NNN-short-title.md
  fixtures/         normative data files (§8.5)
  reference/        tested reference code, non-normative (§8.6)
  phases/           phase-N.md
  tasks/            PN-TNN-short-title.md
CLAUDE.md           how Claude Code works in this repository (repository root)
.claude/status.md   the status log: focus, recent changes, pending decisions, loose ends
.claude/skills/     the status and docs skills (§8.7)
```

### 8.5 Fixtures

Fixtures are data files the spec defines completely. Code blocks in the documents show
excerpts; the fixture file is the whole thing.

| Folder | Becomes | Contains |
|---|---|---|
| `fixtures/library/` | `content-library/` | The built-in library: the Gregorian calendar, four rulesets, a simple slot schema, four starter tone profiles, six themes |
| `fixtures/packs/reference/` | `content-packs/reference/` | Brinemoor, the complete reference pack used for first play and by tests |
| `fixtures/test/` | Read in place by tests | Test-only data: an invented calendar, a Gregorian truth table, a ComfyUI workflow and mapping, a machine config |

- **OVR-030** Library and pack fixtures are copied into the repository byte for byte,
  and `pnpm check` fails if a copy is missing or differs from its fixture. To change
  one, change the fixture first (OVR-020). Files with no fixture, such as the engine's
  prompt templates in `content-library/templates/` (CTX-004), are written in the
  repository as usual.

### 8.6 Reference code

`spec/reference/` holds the code that was used to validate this spec before any task
was written: the contracts, the pure logic that belongs in `packages/core`, the server
interface types, a fixture checker, a drift checker, the docs check (§8.7), and about
250 tests. It is a workspace package, so `pnpm check` runs it; it also runs on its own
(`pnpm install &&
pnpm check` inside the folder). Its README says where each file goes and how to port it.

- **OVR-031** Reference code is **non-normative**. When it disagrees with a spec
  document, the document is right, and the disagreement is handled under CONV-133.
- **OVR-032** A task MAY port reference code instead of writing it from scratch. Ported
  code must meet `02-conventions.md` like any other code, and ported tests must be
  renamed to start with the requirement IDs they verify (CONV-111).
- **OVR-033** TypeScript code blocks in the documents are normative and identical to
  the matching files in `spec/reference/contracts/` and `spec/reference/server-types/`.
  A drift check in `spec/reference/` proves it.

### 8.7 Keeping the spec true

Each document describes its topic as it must be and, once its code lands, as it is.
There is no separate wiki: a topic has one home, and what has been built is never
written by hand (ADR-017). Claude keeps the documents true as part of every task; the
owner decides anything that changes behavior, scope, or a recorded decision
(CONV-133).

- **OVR-034** Amending a requirement keeps its ID. A new requirement takes the next
  unused number in its prefix and goes at the end of the section it belongs to. A
  retired requirement stays where it is, with its text replaced by `(retired, <task or
  date>)` and the reason, for example `- **RUL-014** (retired, P1-T09) Folded into
  RUL-061.` Code and tests never cite a retired ID.
- **OVR-035** A document gains up to three closing sections as its code lands. Each is
  created on first use, after the last numbered section, in this order: **Traps**
  (mistakes that are easy to make again, each naming the requirement or code it
  concerns), **Decisions** (a table with the columns Question, Decision, Rejected and
  why, and Decided by, which holds `owner` or `Claude (ruling)`), and **Open** (known
  limitations and deferred work). They are unnumbered and hold no requirements.
- **OVR-036** An ADR records a decision that crosses documents or sets architecture
  (`decisions/README.md` lists when). Every other decision is a row in the governing
  document's Decisions table. An ADR is `Proposed` until the owner accepts it.
- **OVR-037** A task's state lives only in its file's **Status** row: `Not started` or
  `Done`. Progress is never tracked by hand: `pnpm trace` lists every task with its
  status, the tasks ready to start, and, for each document, how many requirements are
  defined, retired, listed by a done task, and cited by a test name. Each task's GitHub
  issue mirrors its file and is closed by the merge, never edited to show progress
  (CONV-136).
- **OVR-038** `pnpm check` runs the docs check, `spec/reference/scripts/check-docs.ts`.
  It reads the spec, `CLAUDE.md`, `.claude/`, the root and module READMEs, and, under
  `apps/`, `packages/`, and `scripts/`, the `Implements` comments and the test names in
  `*.test.ts` and `*.spec.ts` files. Bold IDs in closing sections are citations, not
  definitions. It fails when:
  1. a requirement ID is defined twice, outside its prefix's document, or out of order
     within its section;
  2. a document, task, test name, or `Implements` comment cites an undefined ID; code
     or a test cites a retired one, or a task not yet done lists one;
  3. a cited ADR has no record; a relative link, a `spec/` path in backticks, or a
     `NN-name.md §N` reference does not resolve;
  4. a task is missing from its phase plan, has another Status, or depends on a task
     that does not exist;
  5. a task marked `Done` depends on one that is not, still holds the completion-notes
     template line or lacks one of its five parts (CONV-135), or lists a requirement
     outside OVR and CONV that no test name cites and that has no `ID: reason` entry
     under **Not tested**.
