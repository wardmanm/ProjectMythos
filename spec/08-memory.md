---
doc: 08-memory
title: Mythos — Memory
status: draft
schemaVersion: 1
requirementPrefix: MEM
---

# Memory

> **For Claude:** read `03-contracts.md` §9 (memory shapes) and `06-turn-engine.md` §6
> (branch-scoped reads) first. `extraction.ts` belongs in `packages/contracts/src/`;
> `queries.ts` defines the public API of `apps/server/src/modules/memory/`. Both were
> typechecked. The extraction mapping, retrieval, and consolidation rules here were
> validated with a reference implementation against a scene from the reference pack.

Memory answers three questions, and keeps them separate:

| Question | Answered by |
|---|---|
| **What happened?** | Observations, the truth store |
| **Who knows it?** | Knowledge grants: who witnessed, who was told, by whom |
| **What matters right now?** | Retrieval: ranked, budgeted memories for one character |

This document covers how observations are recorded (extraction), how knowledge is
tracked, the entity wiki, relationships, retrieval, and consolidation. What the player
sees of it is in `10-journal.md`; how retrieved memories become prompts is in
`09-context.md`.

## 1. Data at a glance

| Data | Kind (TRN §6.1) | Written by | Read by |
|---|---|---|---|
| Observations | Row projection | Extraction, world ticks, consolidation, setup, player | Retrieval, wiki, journal, GM mode |
| Knowledge grants | Row projection | The engine for witnesses; extraction for absent claim audiences; setup; player | Every knowledge-scoped query |
| Relationships | Folded state | Extraction, world ticks, setup, player | Briefs, adjudication, world ticks |
| Entity wiki pages | Folded state | Extraction, world ticks, consolidation, player | Briefs, GM mode |
| Embeddings | Cache | Background `embed` jobs | Retrieval relevance |

## 2. Principles

- **Truth is recorded once.** An observation is what actually happened, written so that
  its witnesses could have perceived it. It is never rewritten to suit a viewpoint.
- **Knowing is separate from happening.** Who knows an observation is a separate record
  (a grant). Different characters can know the same event in different ways.
- **Secondhand knowledge is a claim, never the truth.** When someone is told something,
  what they learn is "X told me that Y", which may be false. The thing it describes is
  never handed to them directly.
- **Retrieval only searches one character's knowledge.** A query for what Odette
  remembers can only return what Odette knows, on the current branch, at the current
  point. Leaks are prevented by construction, not by prompt instructions alone.

## 3. Observations and knowledge

### 3.1 Observations

- **MEM-001** An observation records one thing that happened: one action, one exchange,
  one discovery. Its `text` is third person, past tense, and concrete, e.g. *"Wren asked
  Varek what happened to the Merrow's Luck."*
- **MEM-002** An observation's text contains **only what its witnesses could perceive**.
  A character's inner state (fear, intent, a hidden motive) is a separate observation
  whose only witness is that character: *"Varek feared Wren would learn about the false
  papers"*, witnessed by Varek alone. Its visible sign (*"Varek's hands shook as he
  answered"*) is an ordinary observation everyone present witnessed.
- **MEM-003** Kinds: `event` (something done or perceived), `speech` (talk that asserts
  no fact: questions, requests, threats, feelings), `claim` (someone asserting something
  as fact, true or not), and `summary` (consolidation only, §8).
- **MEM-004** An observation's `gameTime` is the end of its turn's resolution
  (`gameTimeStart + elapsedMinutes`), and its `placeId` defaults to the scene's place.
  Order within a turn is commit order.
- **MEM-005** `mentionedIds` lists entities an observation refers to without them acting
  or witnessing: "Varek said a man named Tomas skippered her" mentions Tomas. Mentions
  count as involvement for retrieval (MEM-077) and make the entity known to everyone
  who knows the observation (JRN-010).

**Importance** (1–10) ranks observations for retrieval and protects them from
consolidation. The extractor scores with this rubric, which the extraction template
includes:

| Score | Meaning | Examples |
|---|---|---|
| 1–2 | Trivial | Small talk, ordering a drink |
| 3–4 | Minor | A routine exchange, a useful detail |
| 5–6 | Notable | A favor, an argument, a new lead, a lie told |
| 7–8 | Significant | A betrayal, an injury, a revelation, a first kiss |
| 9–10 | Life-changing | A death, a confession of love, a sworn enemy made |

### 3.2 Knowledge grants

- **MEM-010** Every witness of an observation receives a grant with `via: 'witnessed'`.
  The engine adds these from `witnessIds`; extraction never lists grants (CON-071).
- **MEM-011** A witness must be a living character at the observation's place (by
  default the scene's): there at the start of the turn, arriving during it, or
  introduced there by the extraction. Anyone else learns of an event only by being
  told. World ticks apply the same rule off-screen (TIME-071).
- **MEM-012** Grants are never removed by play. A character may forget nothing, but
  retrieval decides what surfaces (§6). Only the player removes a grant (GM mode,
  `knowledge.revoke`).

### 3.3 Claims

- **MEM-030** A claim stores "`source` told `audience` that `content`", with the
  content as stated. Its `truthful` field is the extractor's truth-level judgment
  (`true`, `false`, `partly`, `unknown`) and is visible only in GM mode.
- **MEM-031** A claim's `aboutObservationId` links it to the truth it concerns, when
  there is one: Varek's squall story links to the observation that the *Merrow's Luck*
  was lost. This lets GM mode show "this was a lie" and lets world ticks spread rumors
  with fidelity (`12-time-world.md`).
- **MEM-032** Hearing a claim grants knowledge of **the claim only**, never of the
  observation it is about, even when the claim is true. A truthful summary rarely
  carries every detail of the truth, and granting the truth would leak those details.
- **MEM-033** Everyone who witnessed the claim being made knows it, including bystanders
  who overheard.
- **MEM-034** An audience member who was not present (a letter, a message, a shout
  from the street) receives the claim with `via: 'told'`.
- **MEM-035** `told` and `rumor` grants of non-claim observations come only from setup
  (history entries' `alsoKnownBy`), world ticks, and the player. `inferred` grants come
  only from world ticks and the player.

## 4. Extraction

### 4.1 When and with what

Extraction runs as a background job after each turn's narration commits (TRN-054),
using the `extractor` role. Its prompt (`09-context.md`) contains:

- The turn: input, ruling, resolution (outcome, consequences, harm results), and
  narration.
- The scene: place, game time, and every entity present with its ID, name, aliases,
  and kind; nearby places; items present, worn, and carried.
- **Recent observations with handles**: the last observations at this scene and any
  the narration seems to touch, each labeled `#1`, `#2`, …. Handles are local to this
  prompt; the engine keeps the mapping to UUIDs.
- Present characters' wiki section headings, relationships among them, and the
  ruleset's relationship dimensions with descriptions and `maxChangePerTurn`.
- The ruleset's harm tags, levels, and ownership modes.

- **MEM-040** Extraction runs at the point after narration (TRN-060), so it sees the
  turn's resolution applied and nothing later.

### 4.2 Output schema — `extraction.ts`

Like rulings, the schema sent to the model is built per campaign (CON-035): stats,
harm tags, and relationship dimensions are enums of the ruleset's IDs; relationship
changes are capped at `maxChangePerTurn`; and status and clock changes are allowed only
when the ruleset's ownership is `narrative` (otherwise their arrays must be empty).

```ts
import { z } from 'zod';
import { EntityIdSchema } from './primitives';
import { AgeCategorySchema, ContainerSchema, ItemSizeSchema } from './entities';
import { ClockIdSchema, HarmLevelSchema, StatIdSchema, StatusTagSchema } from './rules';

/*
 * Extraction output (08-memory §4). Model-facing (CON-003, CON-004): the model refers to
 * existing entities by EntityId, to entities it introduces by `new.<slug>`, to
 * observations it creates by `o<n>`, and to existing observations by the prompt-local
 * handles `#<n>` it was shown. The engine maps all of these to real IDs.
 */

/** An entity introduced in this output, e.g. `new.kess`. */
export const NewEntityRefSchema = z.string().regex(/^new\.[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** An existing entity or one introduced in this output. */
export const EntityRefSchema = z.union([EntityIdSchema, NewEntityRefSchema]);
/** An observation created in this output, e.g. `o1`. */
export const ObservationRefSchema = z.string().regex(/^o\d{1,3}$/);
/** An existing observation, by the handle shown in the prompt, e.g. `#12`. */
export const ObservationHandleSchema = z.string().regex(/^#\d{1,4}$/);

/** Limits that specialize the schema to one campaign (CON-035, MEM-041). */
export type ExtractionLimits = {
  statIds: readonly [string, ...string[]] | null;
  rating: { min: number; max: number };
  tagIds: readonly [string, ...string[]] | null;
  maxHarmLevel: number;
  dimensionIds: readonly [string, ...string[]] | null;
  maxRelationshipChange: number;
  narrativeStatuses: boolean; // ruleset ownership.statuses === 'narrative'
  narrativeClocks: boolean; // ruleset ownership.clocks === 'narrative'
};

export const BROAD_EXTRACTION_LIMITS: ExtractionLimits = {
  statIds: null,
  rating: { min: -5, max: 20 },
  tagIds: null,
  maxHarmLevel: 9,
  dimensionIds: null,
  maxRelationshipChange: 100,
  narrativeStatuses: true,
  narrativeClocks: true,
};

export function makeExtractionSchemas(limits: ExtractionLimits) {
  const tag: z.ZodType<string> = limits.tagIds ? z.enum(limits.tagIds) : StatusTagSchema;
  const rating = z.int().min(limits.rating.min).max(limits.rating.max);
  const delta = z.int().min(-limits.maxRelationshipChange).max(limits.maxRelationshipChange);
  const statHints: z.ZodType<Record<string, number>> = limits.statIds
    ? (z.strictObject(
        Object.fromEntries(limits.statIds.map((id) => [id, rating.optional()])),
      ) as z.ZodType<Record<string, number>>)
    : z.record(StatIdSchema, rating);
  const deltas: z.ZodType<Record<string, number>> = limits.dimensionIds
    ? (z.strictObject(
        Object.fromEntries(limits.dimensionIds.map((id) => [id, delta.optional()])),
      ) as z.ZodType<Record<string, number>>)
    : z.record(z.string(), delta);
  // Strict: for stat hints and deltas the key is the data, so an unknown key must fail (MEM-042).
  const allowIf = <T extends z.ZodType>(item: T, allowed: boolean, max: number) =>
    z.array(item).max(allowed ? max : 0);

  /** Something that happened, as its witnesses could perceive it (MEM §3). */
  const observation = z.object({
    ref: ObservationRefSchema,
    kind: z.enum(['event', 'speech', 'claim']),
    text: z.string().min(1).max(600), // third person, past tense, perceivable facts only
    actorIds: z.array(EntityRefSchema).max(8),
    witnessIds: z.array(EntityRefSchema).min(1).max(12),
    mentionedIds: z.array(EntityRefSchema).max(8), // referred to, not present or acting
    placeId: EntityRefSchema.nullable(), // null = the scene's place
    importance: z.int().min(1).max(10),
    tags: z.array(z.string().min(1).max(40)).max(6),
    claim: z
      .object({
        sourceId: EntityRefSchema,
        audienceIds: z.array(EntityRefSchema).min(1).max(12),
        content: z.string().min(1).max(600), // what was asserted, as stated
        about: z.union([ObservationRefSchema, ObservationHandleSchema]).nullable(),
        truthful: z.enum(['true', 'false', 'partly', 'unknown']),
      })
      .optional(),
  });

  const newCharacter = z.object({
    kind: z.literal('npc'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120), // a descriptor until a name is learned, e.g. "the bartender"
    aliases: z.array(z.string().max(120)).max(5),
    ageCategory: AgeCategorySchema,
    physicalDescription: z.string().max(600),
    personality: z.string().min(1).max(400),
    stats: statHints, // stats the fiction shows; others take the ruleset default
    locationId: EntityRefSchema.nullable(),
  });
  const newPlace = z.object({
    kind: z.literal('place'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120),
    aliases: z.array(z.string().max(120)).max(5),
    description: z.string().max(1000),
    parentPlaceId: EntityRefSchema.nullable(),
  });
  const itemLocation = z.discriminatedUnion('type', [
    z.object({ type: z.literal('held'), characterId: EntityRefSchema }),
    z.object({ type: z.literal('carried'), characterId: EntityRefSchema }),
    z.object({
      type: z.literal('worn'),
      characterId: EntityRefSchema,
      slot: z.string().min(1),
      layer: z.int().nonnegative(),
    }),
    z.object({ type: z.literal('contained'), containerId: EntityRefSchema }),
    z.object({ type: z.literal('placed'), placeId: EntityRefSchema }),
    z.object({ type: z.literal('gone') }),
  ]);
  const newItem = z.object({
    kind: z.literal('item'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120), // lowercase, no article, singular: "brass key" (GEAR-065)
    aliases: z.array(z.string().max(120)).max(5),
    description: z.string().max(600),
    location: itemLocation,
    ownerId: EntityRefSchema.nullable(),
    quantity: z.int().min(1).max(999),
    size: ItemSizeSchema.nullable(), // needed when the ruleset carries in containers
    weight: z.number().nonnegative().nullable(), // needed when the ruleset uses encumbrance
    container: ContainerSchema.nullable(), // a bag, a box, a coat with pockets
  });
  const newFaction = z.object({
    kind: z.literal('faction'),
    ref: NewEntityRefSchema,
    name: z.string().min(1).max(120),
    aliases: z.array(z.string().max(120)).max(5),
    description: z.string().max(1000),
  });

  const statusChange = z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add'),
      characterId: EntityRefSchema,
      name: z.string().min(1).max(80),
      kind: z.enum(['harm', 'condition']),
      level: HarmLevelSchema.max(limits.maxHarmLevel).nullable(), // null for conditions
      tags: z.array(tag).max(3),
    }),
    z.object({
      op: z.literal('remove'),
      characterId: EntityRefSchema,
      statusName: z.string().min(1).max(80),
    }),
  ]);
  const clockChange = z.object({ clockId: ClockIdSchema, ticks: z.int().min(-6).max(6) });

  const extraction = z.object({
    observations: z.array(observation).max(20),
    newEntities: z
      .array(z.discriminatedUnion('kind', [newCharacter, newPlace, newItem, newFaction]))
      .max(8),
    entityUpdates: z
      .array(
        z.object({
          entityId: EntityRefSchema,
          name: z.string().min(1).max(120).nullable(), // e.g. a real name learned
          addAliases: z.array(z.string().max(120)).max(5),
          physicalDescription: z.string().max(1000).nullable(),
          description: z.string().max(2000).nullable(),
        }),
      )
      .max(8),
    moves: z
      .array(z.object({ characterId: EntityRefSchema, toPlaceId: EntityRefSchema.nullable() }))
      .max(12),
    itemMoves: z
      .array(
        z.object({
          itemId: EntityRefSchema,
          to: itemLocation,
          ownerId: EntityRefSchema.nullable().optional(), // only when ownership changed: a gift, a sale
        }),
      )
      .max(12),
    quantityChanges: z
      .array(z.object({ itemId: EntityRefSchema, delta: z.int().min(-999).max(999) }))
      .max(8),
    namesLearned: z
      .array(
        z.object({
          knowerId: EntityRefSchema, // usually the PC
          entityId: EntityRefSchema,
          name: z.string().min(1).max(120), // as the knower now calls them
        }),
      )
      .max(8),
    relationshipChanges: z
      .array(
        z.object({
          fromId: EntityRefSchema, // the PC only when the ruleset tracks PC relationships (MEM-064)
          toId: EntityRefSchema,
          deltas,
          reason: z.string().min(1).max(300),
          keyObservationRef: z.union([ObservationRefSchema, ObservationHandleSchema]).nullable(), // a defining moment
          summary: z.string().max(600).nullable(), // replaces the summary when it changed
        }),
      )
      .max(12),
    wikiPatches: z
      .array(
        z.discriminatedUnion('op', [
          z.object({
            op: z.literal('upsert'),
            entityId: EntityRefSchema,
            heading: z.string().min(1).max(80),
            body: z.string().min(1).max(1500),
            sourceRefs: z.array(z.union([ObservationRefSchema, ObservationHandleSchema])).max(10),
          }),
          z.object({
            op: z.literal('remove'),
            entityId: EntityRefSchema,
            heading: z.string().min(1).max(80),
          }),
        ]),
      )
      .max(8),
    statusChanges: allowIf(statusChange, limits.narrativeStatuses, 8),
    clockChanges: allowIf(clockChange, limits.narrativeClocks, 6),
  });

  return { observation, newCharacter, newPlace, newItem, newFaction, extraction };
}

const broad = makeExtractionSchemas(BROAD_EXTRACTION_LIMITS);
export const ExtractionSchema = broad.extraction;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedObservation = z.infer<typeof broad.observation>;
```

- **MEM-041** The model-facing schema is `makeExtractionSchemas(extractionLimitsFor
  (ruleset))`; `ExtractionSchema` (broad limits) is used only for storage and tests.
- **MEM-042** Stat hints and relationship deltas are **strict** objects: an unknown
  stat or dimension fails validation and is fed back to the model, rather than being
  silently dropped.
- **MEM-043** The extraction schema is the largest model-facing schema. Providers that
  limit schema complexity may reject it; PRV-053 then retries prompt-only, so the
  extraction template MUST include a complete worked example.

### 4.3 Rules the extractor follows

These are written into the extraction template. Each is also enforced, where possible,
by semantic validation (§4.4).

- **MEM-050** Record what happened in the narration and resolution, nothing invented.
  If the narration states something that contradicts the resolution, the resolution
  wins.
- **MEM-051** Apply MEM-001 and MEM-002: one thing per observation, perceivable facts
  only, inner states as private observations.
- **MEM-052** Record factual assertions as claims, with `about` pointing at the
  observation they concern when one is shown, and lies marked `truthful: 'false'`.
- **MEM-053** Introduce an entity only when it is new. Reference existing entities by
  ID. Name a new character by a descriptor until a name is learned ("the bartender"),
  then rename it with an entity update and keep the descriptor as an alias.
- **MEM-054** Record movement: characters arriving and leaving (`moves`); items changing
  hands, being picked up, or dropped (`itemMoves`, with `ownerId` only when ownership
  changed: a gift or a sale, never a theft); and items used up or split
  (`quantityChanges`). New items get a size or weight as the ruleset's carrying mode
  needs (GEAR-043). The engine starts a new scene when the PC moves to another place.
- **MEM-055** Record how characters' feelings changed, toward the PC or each other,
  with a reason, and a key observation for defining moments. The PC's own feelings
  are recorded only as MEM-064 allows.
- **MEM-056** Patch wiki pages only when something durable changed (§5): a new fact
  about someone, a change in their situation or disposition.
- **MEM-057** Every new character has an `ageCategory`. The hard floor
  (`13-content-settings.md`) depends on it, so the extractor must not guess `adult` for
  someone the fiction presents as a child; when the fiction is unclear, it records
  `minor` (CSET-045).
- **MEM-058** Record names learned (`namesLearned`), in both directions: when someone
  introduces themself, when a nickname or title is used, and, on the PC's first
  encounter with an unintroduced character, how the PC would refer to them ("the lean
  clerk"). These drive display names (JRN §3).

### 4.4 From output to commits

The engine converts the output into one extraction commit set, in this order:

1. **New entities** get IDs (`<kind>.<slug>-<4 hex>`, CON-011), then `entity.create`.
   New characters take the ruleset's `stats.default` for every stat not hinted, start
   with no statuses or goals, and are alive.
2. **Entity updates** become `entity.update-narrative` (added aliases are merged).
3. **Moves** become `entity.move`; if the PC moved to another place, a `scene.start`
   follows. **Item moves** become `item.move`, and **quantity changes** become
   `item.quantity` with the new total.
4. **Observations** get UUIDs, then `observation.add`, each followed by its grants:
   `witnessed` for every witness (MEM-010), and `told` for any claim audience member who
   was not a witness (MEM-034).
5. **Names learned** become `knowledge.name`. **Relationship changes** become
   `relationship.adjust`.
6. **Wiki patches** become `wiki.patch`.
7. **Status and clock changes** (narrative ownership only) become `status.add`,
   `status.remove`, and `clock.tick`.

- **MEM-060** References resolve as follows: `new.<slug>` to the ID assigned in step 1;
  `o<n>` to the UUID assigned in step 4; `#<n>` through the prompt's handle map. A
  reference that doesn't resolve is a semantic issue.
- **MEM-061** Semantic validation collects **every** issue with a path, and the
  structured-output pipeline feeds them back to the model for a retry (PRV-050). Issues
  checked:
  - Every reference resolves.
  - A new entity's name or alias does not match an entity in the prompt's entity list
    (a likely duplicate: "reference npc.odette instead").
  - Witnesses satisfy MEM-011.
  - `kind: 'claim'` and the `claim` field go together.
  - Relationship changes are from a character, not reflexive, and not from the PC
    unless the ruleset tracks PC relationships (MEM-064).
  - Moves are of characters.
  - A status to remove is matched by exactly one status name on that character.
  - Quantity changes are non-zero and never take a stack below 0.
  - Item moves satisfy the carrying rules (GEAR-053).
  - A harm status has a level, and a condition does not.
  - All commit-level validation (CON-024, the commit allowlist).
- **MEM-062** If extraction still fails after retries, the turn becomes
  `extraction-failed` (TRN-055) and nothing from that attempt is committed.

### 4.5 The PC's inner life

The PC's inner life belongs to the player. The ruleset's `relationships.trackPc`
decides whether extraction may record the PC's side of relationships.

| `trackPc` | The PC's relationships are set by |
|---|---|
| `off` | The player only: in the journal (`10-journal.md`) or by editing state |
| `auto` | Extraction too, from what the player expressed; the player can still edit them |

- **MEM-063** Extraction never writes the PC's thoughts, feelings, or intentions as
  observations unless the player stated them in their input. Narration describing the
  PC's feelings ("you feel a pang of guilt") is not evidence of them.
- **MEM-064** With `trackPc: 'auto'`, extraction may record relationship changes
  **from** the PC, based only on what the player's input expressed through words and
  actions: defending Odette, lying to Varek, saying "I trust you". The change's
  `reason` must cite that input. Narration about the PC's feelings is not evidence.
  With `trackPc: 'off'`, any relationship change from the PC is a semantic issue.
- **MEM-065** PC relationships, however they were set, appear in the journal and in
  narration context, so the narrator can reflect them (a growing romance, a deepening
  grudge). The standard ruleset ships with `trackPc: 'off'`.

## 5. The entity wiki

Every entity has a **wiki page**: its `canon` (the pack's Markdown, read-only) plus
`learned` sections maintained during play. Pages are truth-level.

- **MEM-070** Learned sections are keyed by heading and replaced whole by
  `upsert-section`. Suggested headings, which the extraction template offers:

| Entity kind | Suggested headings |
|---|---|
| Character | Current situation · Disposition · Known for · Secrets · Possessions of note |
| Place | Current state · Who is usually here · Notable events |
| Faction | Current aims · Standing · Notable members |
| Item | History · Current state |

- **MEM-071** A section body is at most 1,500 characters, and a page's learned sections
  together at most 6,000. Consolidation rewrites pages that exceed this (§8.3).
- **MEM-072** A page is the GM's reference for portraying an entity. It is used in
  prompts as a whole, so it must not mix in other characters' private knowledge: a
  secret belongs on the page of the character who holds it (Varek's page says he
  falsified the papers; Odette's page does not say "Varek lied to her").
- **MEM-073** Each section keeps `sourceObservationIds`, so GM mode can show where a
  statement came from, and the journal (`10-journal.md`) can tell which parts the PC
  could know.

## 6. Retrieval

### 6.1 Query API — `queries.ts`

```ts
import type {
  EntityId,
  EntityWikiPage,
  GameTime,
  KnowledgeGrant,
  Observation,
  ReadPoint,
  Relationship,
  RetrievedObservation,
} from '@mythos/contracts';

/** An observation as one entity knows it. */
export type KnownObservation = {
  observation: Observation; // amendments applied; conflicted commits excluded (TRN-072)
  via: KnowledgeGrant['via'];
  viaObservationId: string | null;
  knownSince: GameTime;
};

export type RetrievalRequest = {
  knowerId: EntityId; // whose memory to search
  queryText: string; // usually the player's input; embedded for relevance
  focusEntityIds: EntityId[]; // present or mentioned entities (MEM-077)
  pcId: EntityId; // memories involving the PC get the pc weight and pinning
  tokenBudget: number; // from the context tier (09-context)
};

/**
 * The memory module's read API (MEM §6). Every function is scoped to a read point
 * (ARCH-043, TRN-062). Results never include anything the point cannot see.
 */
export type MemoryQueries = {
  /** Observations an entity knows, newest first. */
  knownObservations(
    point: ReadPoint,
    entityId: EntityId,
    filter?: { involvingEntityId?: EntityId; since?: GameTime; limit?: number },
  ): KnownObservation[];

  /** How an entity knows an observation, or null if it does not. */
  knows(point: ReadPoint, entityId: EntityId, observationId: string): KnownObservation | null;

  /** Everyone who knows an observation (GM mode, consolidation). */
  knowersOf(
    point: ReadPoint,
    observationId: string,
  ): { entityId: EntityId; via: KnowledgeGrant['via'] }[];

  /** Truth-level page: canon plus learned sections (MEM §5). */
  wikiPage(point: ReadPoint, entityId: EntityId): EntityWikiPage;

  relationship(point: ReadPoint, fromId: EntityId, toId: EntityId): Relationship | null;
  relationshipsFrom(point: ReadPoint, fromId: EntityId): Relationship[];

  /** Ranked, budgeted memories for one knower (MEM §6.3–6.4). */
  retrieve(point: ReadPoint, request: RetrievalRequest): Promise<RetrievedObservation[]>;

  /**
   * Entities named in text by name or alias, limited to those the knower has encountered:
   * a name the PC has never heard is not matched (MEM-077).
   */
  resolveMentions(point: ReadPoint, text: string, knowerId: EntityId): EntityId[];
};
```

### 6.2 Candidates

- **MEM-074** A retrieval's candidates are the observations the knower knows at the
  read point (`knownObservations`), excluding observations replaced by a summary the
  knower also knows (§8).
- **MEM-075** Selection fills the token budget in this order, skipping any memory that
  doesn't fit and continuing with the next:
  1. **Pinned recent:** the `pinnedRecent` most recent observations involving the PC
     (machine config, default 3), so a conversation picks up where it left off.
  2. **Pinned key:** the key observations of the knower's relationship with the PC.
  3. **Scored:** everything else, highest score first.
- **MEM-076** The selected memories are returned in chronological order, which reads
  naturally in a prompt. Claims are rendered from the knower's point of view: *"Varek
  told you that the pass is safe."* A claim known as rumor reads as hearsay: *"Word has
  it that the pass is safe (the story started with Varek)."* (TIME-073)

### 6.3 Scoring

```
score = w.importance × importance / 10
      + w.recency    × 0.5 ^ (age in game days / recencyHalfLifeDays)
      + w.relevance  × max(0, cosine(query, observation))
      + w.entities   × (1 if it involves a focus entity)
      + w.pc         × (1 if it involves the PC)
```

- **MEM-077** **Focus entities** are those present in the scene plus those mentioned in
  the player's input. Mentions are matched by `resolveMentions`, which only matches
  names the knower has encountered, so typing a name the PC has never heard does not
  pull that character's memories into the prompt.
- **MEM-078** Weights, the half-life, and pin counts come from the `memory` section of
  machine config (defaults: importance 1, recency 1, relevance 1.5, entities 0.5, PC
  0.5; half-life 14 game days; 3 pinned). Every retrieved memory records its score
  parts, which the context inspector shows.

### 6.4 Embeddings

- **MEM-080** After an extraction, world-tick, or consolidation set commits, an
  `embed` job (extraction priority) embeds each new observation's text (for claims,
  the rendered claim) with the `embedder` role.
- **MEM-081** Embeddings are stored once per (text hash, embedding model), so copies
  and repeats reuse them (TRN-063). When the embedder model changes, a background job
  re-embeds the campaign; until it finishes, observations without a current embedding
  score 0 on relevance.
- **MEM-082** The query (the player's input) is embedded at interactive priority at the
  start of each turn. If the embedder is unavailable, relevance is 0 for that turn and
  a warning is logged; retrieval still works.
- **MEM-083** Similarity is computed in-process over the candidates (a knower's
  knowledge on one branch), not with a vector index. This is fast enough for very long
  campaigns (tens of thousands of observations take milliseconds), avoids a native
  dependency, and makes knowledge scoping exact. `retrieve` hides the method, so an
  index can be added later if profiling shows a need.

### 6.5 Performance

- **MEM-084** Retrieval for a scene with six characters, excluding the query embedding,
  completes in under 100 ms on a campaign with 20,000 observations. A test enforces it.

## 7. Relationships

- **MEM-090** Relationships are directed, from one character to another (or to a
  faction, if the ruleset allows). Their dimensions, range, and per-turn change limit
  come from the ruleset (RUL-141).
- **MEM-091** Extraction and world ticks change them by `relationship.adjust`; setup and
  the player set them with `relationship.set`. World ticks never change relationships
  from the PC; extraction does so only under MEM-064.
- **MEM-092** A relationship keeps a `summary` (one or two sentences on how the
  character sees the other, replaced when it changes) and up to 20 key observations.
  When the 21st is added, the lowest-importance one is dropped.
- **MEM-093** NPC-to-NPC relationships matter as much as NPC-to-PC ones: they drive
  world ticks and rumor spread (`12-time-world.md`).

## 8. Consolidation

Old, minor memories are compressed into summaries so retrieval stays sharp and prompts
stay small. Nothing is deleted.

### 8.1 What gets consolidated

- **MEM-100** Every `consolidation.everyTurns` turns (machine config, default 25), a
  `consolidation` job runs on the branch head. It is skipped if `consolidation.enabled`
  is false.
- **MEM-101** An observation is eligible when it is older than `afterDays` game days
  (default 30), has importance at most `maxImportance` (default 4), is not a summary,
  and is not already summarized.
- **MEM-102** Eligible observations are grouped by **exactly who knows them**, then by
  place and game week. Groups smaller than `minGroupSize` (default 4) are left alone.
- **MEM-103** Grouping by exact knower set is what makes consolidation leak-proof: a
  summary is granted to precisely the characters who knew every observation in it, so
  it never tells anyone something they didn't know.

### 8.2 The summary

- **MEM-104** The `consolidator` role receives each group's observations in order and
  returns one summary text per group (structured output: `{ groupIndex, text }[]`). The
  summary follows MEM-001 and MEM-002 and keeps names, places, and anything a later
  conversation might refer to.
- **MEM-105** The consolidation set adds a `kind: 'summary'` observation with
  `summarizesIds`, the latest game time and place of the group, and importance equal to
  the group's highest. Each knower of the group gets a grant: `witnessed` if they
  witnessed every original, otherwise `told`.
- **MEM-106** Originals stay in the store and in GM mode; retrieval simply prefers the
  summary (MEM-074). Superseding the consolidation set (a player edit) restores them.

### 8.3 Wiki compaction

- **MEM-107** In the same job, any page over the MEM-071 limits is rewritten by the
  consolidator into fewer, shorter sections, with their `sourceObservationIds` merged.

## 9. Knowledge integrity

The guarantees, and where each is enforced:

| Guarantee | Enforced by |
|---|---|
| Nobody knows an event they didn't witness or weren't told | Witness check (MEM-011); grants only from witnesses and claim audiences |
| Being told never reveals more than was said | Claims never grant the truth (MEM-032) |
| A character's secrets don't spread by summarizing | Consolidation by exact knower set (MEM-103) |
| A character's prompt can't contain another's memories | Retrieval is knowledge-scoped (MEM-074) |
| Other timelines never leak | Every query takes a read point (TRN-062) |
| Unheard names don't pull in memories | `resolveMentions` limited to encountered names (MEM-077) |

- **MEM-110** What remains is the narrator seeing several characters' briefs at once.
  `09-context.md` partitions them clearly and offers a strict mode in which each NPC's
  dialogue is written by a separate call that sees only that NPC's brief.

## 10. Player edits and GM mode

- **MEM-120** In GM mode the player can view and edit any observation
  (`observation.amend`), grant or revoke knowledge (`knowledge.grant`,
  `knowledge.revoke`), set relationships (`relationship.set`), and edit wiki sections
  (`wiki.patch`), all through player-edit sets (TRN §7). Edits on non-head turns need a
  history mode.
- **MEM-121** Outside GM mode, the player sees and edits only the journal: the PC's
  knowledge, notes, and beliefs (`10-journal.md`).

## 11. Phase delivery

Phase 4 delivers everything in this document. Turns before phase 4 have no extraction,
so memory starts with phase 4 campaigns. Setup still converts history into
observation, grant, and name commits from phase 1, so knowledge boundaries exist from
the first playable version; the memory projections are built from those commits in
phase 4 (ARCH-042).

## 12. Required tests

All against the mock provider and a temporary database.

- **MEM-130** The reference scene (Wren asks Varek about the *Merrow's Luck* in the
  Gull and Anchor while Odette listens): a new bartender is created with default
  stats except those hinted; all four present characters witness the exchange; only
  Varek knows his own fear; an absent recipient of Varek's note learns it as a claim;
  nobody is granted the truth behind Varek's lie; local references and handles resolve.
- **MEM-131** Each class of extractor mistake in MEM-061 is reported with its path,
  all in one pass.
- **MEM-132** The specialized schema rejects deltas over the limit, unknown dimensions,
  and status changes under authoritative ownership.
- **MEM-133** Retrieval pins recent and key memories, ranks the rest, skips what
  doesn't fit and keeps packing, excludes summarized originals, and returns them in
  chronological order.
- **MEM-134** Consolidation never groups observations known by different sets of
  characters, and leaves important, recent, and small groups alone.
- **MEM-135** Retrieval on two diverged branches, and at two read points on one branch,
  returns different results (TRN-148).
- **MEM-136** MEM-084's performance bound, with a generated 20,000-observation campaign.
- **MEM-137** A relationship change from the PC is rejected with `trackPc: 'off'` and
  recorded with `trackPc: 'auto'`.
