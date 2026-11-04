---
doc: 10-journal
title: Mythos — Journal
status: draft
schemaVersion: 1
requirementPrefix: JRN
---

# Journal

> **For Claude:** the journal is a read model over memory (`08-memory.md`), scoped to one
> knower. Read `08-memory.md` §1–3 first. `journal.ts` belongs in
> `packages/contracts/src/`. The rules for known entities, names, and visible sections
> were validated with a reference implementation.

The journal is the player's notebook: everything their character knows, how they came
to know it, and what the player has written down. It is built from the PC's knowledge
alone, so it can never spoil anything. GM mode can view the same thing from any
character's point of view.

## 1. Principles

- **Derived, not stored.** Apart from notes, beliefs, and learned names, the journal is
  computed from the PC's knowledge at the current point. It is never out of date and
  never contradicts memory.
- **The PC's point of view.** Titles use the names the PC knows; entries are what the
  PC witnessed or was told; claims show who said them. Nothing reaches the journal
  that the PC doesn't know.
- **The player's parts are the player's.** Notes, beliefs, the PC's feelings, names,
  and corrections to what the PC witnessed can all be edited, outside GM mode.

## 2. Known entities

- **JRN-010** An entity is **known** to a knower if it appears in any observation they
  know: as an actor, witness, mentioned entity (`mentionedIds`), place, claim source, or
  claim audience. The knower, their possessions, and their current place are always
  known.
- **JRN-011** The journal index lists known entities by kind (characters, places,
  factions, items), with whether each is present, when the PC last encountered them,
  and their note and belief counts. Entities the PC doesn't know never appear, even
  by count.

## 3. Names

The truth store knows Varek Holm's name. Wren doesn't, until he tells her, and until
then the journal must not use it either.

- **JRN-020** The **display name** of an entity, for a knower, is: the latest name the
  knower learned (a `knowledge.name` commit); otherwise, for the knower themself, or a
  place, faction, or item, the entity's name; otherwise the character's first alias;
  otherwise "someone you have not been introduced to".
- **JRN-021** Names are learned through extraction's `namesLearned` (MEM-058), in both
  directions: when Wren introduces herself, Varek learns her name too. On first meeting
  an unintroduced character, extraction records how the PC would refer to them ("the
  lean clerk").
- **JRN-022** At campaign creation, setup records a `knowledge.name` for the PC for
  every character in a history entry the PC knows, so pre-campaign acquaintances are
  known by name from the first turn.
- **JRN-023** The player may rename any entity in the journal. That records a
  `knowledge.name` for the PC (a player edit); it never changes the entity's true name.
- **JRN-024** Display names are used everywhere the PC's point of view is shown: the
  journal, the scene panel, and the names in the narrator's and suggestions' public
  blocks (CTX-052). An NPC's voice prompt uses that NPC's own names for others.
- **JRN-025** A page's `otherNames` lists the earlier names the knower used, so "the
  lean clerk" stays findable after he becomes Varek.

## 4. Entity pages

A page shows, for one known entity:

| Part | Source | Editable outside GM mode |
|---|---|---|
| Title and other names | §3 | Rename |
| Common knowledge | The canon's `## Common knowledge` section | No |
| What you've learned | Visible wiki sections | No |
| Your feelings | The knower's own relationship to the entity | Yes |
| Entries | Known observations involving the entity | Corrections only (JRN-041) |
| Notes and beliefs | The player's | Yes |

- **JRN-030** A wiki section (MEM §5) is shown only if it has at least one source
  observation and the knower knows **every** source. A section mixing public and secret
  facts stays hidden, which is safe even when it means the PC sees less than they could.
- **JRN-031** Pack authors mark public lore with a `## Common knowledge` heading in an
  entity's canon Markdown. That section is shown once the entity is known; the rest of
  the canon never is.
- **JRN-032** Relationships shown are only the knower's own feelings toward the entity.
  How an NPC feels about the PC is truth and appears only in GM mode.
- **JRN-033** A **"What do I know?"** action asks the `consolidator` role for a short
  summary of the page's visible content only. It is cached by the exact set of entries
  it summarized and is labeled as a summary.

## 5. Chronicle, claims, and search

- **JRN-034** The **chronicle** lists every known observation, newest first, paged by
  game time, with its date, place, and how it was learned. It can be filtered by
  entity.
- **JRN-035** The **claims** view lists everything the PC has been told, by whom, and
  when, with a shortcut to record a belief about each ("I don't believe Varek's squall
  story"). Whether a claim was true is never shown outside GM mode.
- **JRN-036** **Search** matches text across known entries (rendered as the knower sees
  them), display names, notes, and beliefs.

## 6. Notes, beliefs, and corrections

- **JRN-040** **Notes** are free text, optionally about one entity. They are the
  player's scratchpad and are **never** sent to a model.
- **JRN-041** **Corrections.** Outside GM mode, the player may amend the text of any
  observation the PC witnessed, and the content of any claim addressed to the PC, when
  extraction got it wrong. A correction is an `observation.amend` in a player-edit set
  (`claimContent` for claims). It changes the record of what happened, so it changes
  what every witness remembers; the edit dialog says so.
- **JRN-042** **Beliefs** are statements of what the PC thinks is true, with a
  confidence (`suspect`, `believe`, `certain`). They are sent to the adjudicator and
  narrator, labeled as beliefs that may be wrong (CTX-051), so the PC can act on them.
  They never change truth, and extraction never writes them.
- **JRN-043** Notes, beliefs, renames, and the PC's feelings are player-edit commits
  (TRN §7), so they follow the branch they were made on and can be undone like any
  edit.

## 7. The PC's own page

- **JRN-044** The PC's page shows their stats, statuses, gear (`11-gear.md`), their
  feelings toward everyone, and notes and beliefs about themself. It is the character
  sheet as well as a journal page.

## 8. GM mode

- **JRN-050** In GM mode the journal gains a **"view as"** selector: any character's
  journal, built the same way from that character's knowledge and names. It is the most
  direct way to check knowledge boundaries ("what does Odette actually know?").
- **JRN-051** GM mode also marks claims as true, false, or partly true; shows hidden
  wiki sections and full canon; and shows NPCs' feelings toward the PC. Outside GM mode
  none of these are sent to the client (TRN-081 applies the same way).

## 9. Export and performance

- **JRN-060** The journal exports to Markdown from the PC's point of view: the index,
  every page, and the chronicle (OVR export formats).
- **JRN-061** Journal views are computed on request and cached until the next
  `state.changed` event on the branch. A page loads in under 200 ms on a campaign with
  20,000 observations.

## 10. API

All paths are under `/api/campaigns/:campaignId/journal`. Edits are convenience
endpoints that build a player-edit set (`EditStateCommand`) on the branch head.

| Method & path | Body | Returns |
|---|---|---|
| `GET /?knowerId=` | — | `JournalEntrySummary[]` |
| `GET /entities/:entityId?knowerId=&before=` | — | `JournalPage` |
| `GET /chronicle` | `ChronicleQuery` as query string | `JournalItem[]` |
| `GET /claims?knowerId=` | — | `JournalItem[]` (claims only) |
| `GET /search?q=` | — | Matching entries, names, notes, beliefs |
| `POST /entities/:entityId/summary` | — | Summary text (JRN-033) |
| `POST /notes`, `PATCH /notes/:id`, `DELETE /notes/:id` | `Note` fields | `Note` |
| `POST /beliefs`, `PATCH /beliefs/:id`, `DELETE /beliefs/:id` | `Belief` fields | `Belief` |
| `POST /entities/:entityId/name` | `{ name }` | `JournalPage` |
| `POST /entities/:entityId/feelings` | `{ dimensions, summary }` | `JournalPage` |
| `POST /corrections` | `{ observationId, text?, claimContent? }` | `JournalItem` |
| `GET /export` | — | Markdown file |

- **JRN-070** `knowerId` other than the PC is accepted only in GM mode; otherwise the
  server returns `validation_failed`.

## 11. Contracts — `journal.ts`

```ts
import { z } from 'zod';
import { EntityIdSchema, EntityKindSchema, GameTimeSchema, IdSchema } from './primitives';
import { BeliefSchema, KnowledgeViaSchema, NoteSchema } from './memory';

/*
 * The player's journal (10-journal). Everything here is derived from one knower's
 * knowledge: the PC normally, any character in GM mode's "view as".
 */

export const JournalEntrySummarySchema = z.object({
  entityId: EntityIdSchema,
  kind: EntityKindSchema,
  displayName: z.string(), // as the knower knows them (JRN-020)
  lastEncountered: GameTimeSchema.nullable(),
  present: z.boolean(), // in the knower's current scene
  noteCount: z.int().nonnegative(),
  beliefCount: z.int().nonnegative(),
});
export type JournalEntrySummary = z.infer<typeof JournalEntrySummarySchema>;

/** One known observation as the journal shows it. */
export const JournalItemSchema = z.object({
  observationId: IdSchema,
  gameTime: GameTimeSchema,
  gameTimeLabel: z.string(),
  text: z.string(), // claims rendered as "<source> told you that <content>" (MEM-076)
  via: KnowledgeViaSchema,
  placeName: z.string().nullable(),
  importance: z.int().min(1).max(10),
  correctable: z.boolean(), // the player may amend it outside GM mode (JRN-041)
});
export type JournalItem = z.infer<typeof JournalItemSchema>;

export const JournalPageSchema = z.object({
  entityId: EntityIdSchema,
  kind: EntityKindSchema,
  displayName: z.string(),
  otherNames: z.array(z.string()), // earlier names and descriptors the knower used
  commonKnowledge: z.string().nullable(), // from canon (JRN-031)
  sections: z.array(z.object({ heading: z.string(), body: z.string() })), // wiki sections the knower may see (JRN-030)
  relationship: z // the knower's own feelings toward this entity; editable
    .object({ dimensions: z.record(z.string(), z.int()), summary: z.string() })
    .nullable(),
  items: z.array(JournalItemSchema), // newest first, paged
  notes: z.array(NoteSchema),
  beliefs: z.array(BeliefSchema),
});
export type JournalPage = z.infer<typeof JournalPageSchema>;

export const ChronicleQuerySchema = z.object({
  knowerId: EntityIdSchema.optional(), // GM mode only; defaults to the PC
  entityId: EntityIdSchema.optional(),
  search: z.string().max(200).optional(),
  beforeGameTime: GameTimeSchema.optional(),
  limit: z.int().min(1).max(200).default(50),
});
```

## 12. Phase delivery and tests

Phase 5 delivers this document. Display names (JRN-020) are used in prompts from
phase 1, from the names setup records (JRN-022); learning names in play starts in
phase 4, with extraction.

- **JRN-080** Known entities include mentioned characters and exclude everything the
  PC has no observation of.
- **JRN-081** Display names: descriptor before introduction, the learned name after,
  own name for oneself, entity names for places; renaming never changes truth.
- **JRN-082** Wiki sections appear only when every source is known.
- **JRN-083** Common knowledge is extracted from canon; the rest of canon never
  appears outside GM mode.
- **JRN-084** No journal response outside GM mode contains a claim's truthfulness, an
  NPC's feelings toward the PC, a hidden section, or any observation the PC doesn't
  know (property test over a generated campaign).
- **JRN-085** "View as" Odette in the reference scene shows Varek's squall story as a
  claim, and nothing about the false papers.
