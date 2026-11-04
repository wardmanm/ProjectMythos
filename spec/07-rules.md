---
doc: 07-rules
title: Mythos — Rules
status: draft
schemaVersion: 1
requirementPrefix: RUL
---

# Rules

> **For Claude:** rules logic lives in `packages/core` and is pure (ARCH-010): dice come
> from an injected `Rng`, and functions return data instead of writing it. **No rule
> value is hard-coded.** Every number, list, and choice in this document is read from
> the campaign's ruleset (`04-content-schemas.md` §7). When this document says "the
> standard ruleset uses…", that is an example value, not a constant. The probability
> tables were generated from a reference implementation and are exact.

## 1. Principles

- **Rules are data.** A ruleset describes a whole game system: its stats, how dice are
  read, what effect does, how harm works, how fast it heals. The engine is a fixed set
  of **building blocks**; a ruleset chooses and parameterizes them. Mythos ships a
  standard ruleset plus three very different examples (Appendix A) to prove it.
- **Fiction first.** Most outcomes are decided by the GM from what the player actually
  says and does. That is a **direct ruling**. No stat ever decides whether an argument
  is convincing; the words do (§2.1).
- **Roll only when it matters.** A roll is called only when the outcome is both
  **uncertain** and **risky**. Noticing things, recalling facts, ordinary conversation,
  and routine actions are never rolled.
- **The GM judges; the engine counts.** The GM decides whether to roll, the difficulty
  of the situation, and the stakes. The engine applies stats, harm, items, effect,
  armor, resistance, overflow, healing, and clocks.
- **Stakes before dice.** The GM commits to what each result means before rolling, and
  the player sees it.
- **The player has the last word.** Every result can be overridden in the resolution
  draft or edited afterward (`06-turn-engine.md`), free of charge.

### 1.1 What a ruleset can and cannot change

| A ruleset sets | Fixed in the engine |
|---|---|
| The stats: how many, their names, descriptions, and rating range | One action roll per turn; rolls are player-facing (§4.6) |
| The dice method, die size, pool limits, result bands, and criticals | The four result tiers (critical, success, partial, failure); a ruleset relabels and maps dice to them |
| Difficulty range, the opposed formula, and GM guidance | The three effect levels (limited, standard, great); a ruleset relabels them and sets what they do |
| Effect by rating, critical bonus, and effect scaling | The stakes structure (§4.2) and draft order (§5) |
| Harm tags, levels, capacity, penalties, healing, overflow | The harm pipeline order: armor, resistance, placement, lethality |
| Resistance: on or off, who resists, reduction table | |
| Lethality, clocks, stat change, relationships, carrying | |

- **RUL-001** The fixed column is the boundary of configuration. Something outside both
  columns (exploding dice, opposed rolls by both sides, multiple rolls per turn) is a
  new building block: a code change with an ADR, after which rulesets can use it.
  A new ruleset is never a code change.
- **RUL-002** A ruleset is checked by `rulesetIssues` (§12) before use, and every
  problem is reported. A ruleset with issues cannot be used to create a campaign.

## 2. Stats

The ruleset's `stats.list` defines the stats, each with an ID, name, abbreviation, and a
description that is shown to the GM and the player. `stats.min` and `stats.max` set the
rating range. Every character, including NPCs, has a rating for every stat.

The standard ruleset uses five stats rated 1–5:

| Stat | Covers |
|---|---|
| **Strength (STR)** | Force, power, lifting, grappling, melee impact |
| **Endurance (END)** | Stamina, toughness, resisting pain, poison, cold, and strain |
| **Dexterity (DEX)** | Agility, reflexes, stealth, precision, ranged attacks, sleight of hand |
| **Intelligence (INT)** | Reasoning, knowledge, crafting, medicine, technology |
| **Charisma (CHA)** | Presence, poise, delivery, performance |

- **RUL-010** Ratings never leave `stats.min…stats.max`, including through stat change
  (§8.3).
- **RUL-011** NPC stats are used by the GM to judge difficulty (§3.2). NPCs never make
  action rolls of their own (§4.6).
- **RUL-018** `stats.default` is the rating for any stat not given: for example, the
  stats of an NPC introduced during play that the fiction hasn't shown (MEM §4.4). The
  standard ruleset's default is 2, an ordinary person.

### 2.1 Social and creative stats in a fiction-first game

These principles hold in every ruleset; the stat names below are the standard ones.

- **RUL-012** **No stat decides whether an argument works.** The content of what the
  player says decides that, judged against the listener's personality, knowledge, and
  relationship to the PC. A presence stat (CHA) decides **how it comes across**: with
  low CHA a clumsy line lands as an insult, and even a good argument may cost goodwill;
  with high CHA the same line reads as a charming joke. The GM expresses this in the
  direct ruling, and extraction records it in the relationship.
- **RUL-013** A presence stat is rolled only when delivery itself is the uncertain,
  risky part: lying to a suspicious guard, holding a hostile crowd, performing. Even
  then, the quality of the words sets the difficulty (RUL-022).
- **RUL-014** A reasoning stat (INT) mostly sets **quality** through effect (§3.4): at
  INT 1, even a success only half works; at INT 5, even a partial is workable.

## 3. Rolls

### 3.1 When to roll

- **RUL-015** The GM calls for a roll only when the outcome is uncertain and failure
  would cost something. Otherwise the GM rules directly.
- **RUL-016** At most one action roll per turn. If the player does several things, the
  GM rolls for the riskiest and rules on the rest directly. Resistance rolls (§6.3) do
  not count.
- **RUL-017** Perception, noticing, and recall are never rolled. If something can be
  noticed and the PC is in a position to notice it, they do.

### 3.2 Points

Everything that affects a roll is counted in **points**:

```
points = stat rating + difficulty + item points − harm points
```

What a point means depends on the dice method: one die in a pool method, or
`pointValue` added to the total in the sum method.

- **RUL-020** **Difficulty** reflects the **situation only**: the opposition,
  circumstances, help, the quality of the approach. It stays within the ruleset's
  `difficulty.min…max`. The GM never adjusts difficulty for the actor's own harm or
  gear; the engine does that.
- **RUL-021** When the ruleset has an `opposedBaseline`, an action opposed by a
  character starts at `opposedBaseline − opponent's relevant stat`, adjusted ±1 for
  circumstances and clamped to the range. In the standard ruleset (baseline 3), a PC
  with STR 3 arm-wrestling a child (STR 1) gets +2, for 5 dice; against a professional
  wrestler (STR 5), −2, for 1 die.
- **RUL-022** For a roll on a presence stat, the player's actual words adjust
  difficulty: a compelling, well-fitted approach up to +2; a weak one down to −2.
- **RUL-023** **Item points:** the ruling's `itemIds` lists items the actor uses. Each
  contributes its `roll` bonus's `points` if the bonus's `stat` is absent or matches.
  The total is capped at `items.maxRollBonus`, and a capped item shows its capped value.
  An item must be worn, held, or carried by the actor, or inside a container they
  carry; otherwise the ruling fails semantic validation and is retried (PRV-050).
- **RUL-024** **Harm points** are applied by the engine (§6.4).
- **RUL-025** The ruleset's `difficulty.guide` lines are shown to the GM in the
  adjudication prompt so it knows what each value means in this ruleset.
- **RUL-026** Every adjustment is recorded on the roll as a labeled modifier, so the
  dice card can show, for example, "STR 3 · difficulty −1 · Grappling hook +1 ·
  Cracked Ribs −1 = 2 dice".

### 3.3 Dice methods

The ruleset's `dice.method` picks one of three building blocks.

| Method | Roll | Read | In the style of |
|---|---|---|---|
| `pool-highest` | `points` dice, at most `maxPool` | The highest die | Blades in the Dark |
| `pool-count` | `points` dice, at most `maxPool` | How many dice show `successOn` or higher | World of Darkness |
| `sum` | A fixed `dice` count | The dice total plus `points × pointValue` | 2d6 + stat; d20 + modifier |

- **RUL-030** **Empty pools.** In a pool method, when points are 0 or less, roll
  `emptyPool.roll` dice and keep the `lowest` or `highest` one; only the kept die is
  read. The standard ruleset rolls two and keeps the lowest.
- **RUL-031** **Bands.** The read value maps to a result through `dice.bands`, ordered
  highest `min` first: the first band whose `min` the value reaches gives the result.
  A value below every band takes the last band's result.
- **RUL-032** **Criticals.** If `dice.critical` is `faces`, the roll is a critical when
  at least `count` of the dice that count show `face`, whatever the bands say. "The
  dice that count" are all dice, or only the kept die for an empty pool, so two sixes
  can never come from a two-die empty pool that keeps one. A band may also produce
  `critical` directly (for example, four successes in a counting pool).
- **RUL-033** Results are always one of `critical`, `success`, `partial`, `failure`.
  The ruleset's `results.labels` gives their display names ("Strong hit", "Miss").
- **RUL-034** A ruleset need not use every tier: a sum method with no critical rule and
  no `critical` band never produces one.

**Standard ruleset** (d6 pool, highest die: 6 success, 4–5 partial, 1–3 failure; two
6s critical; empty pool rolls two and keeps the lowest):

| Dice (points) | Critical | Success | Partial | Failure |
|---|---|---|---|---|
| 0 or less | — | 3% | 22% | 75% |
| 1 | — | 17% | 33% | 50% |
| 2 | 3% | 28% | 44% | 25% |
| 3 | 7% | 35% | 45% | 13% |
| 4 | 13% | 39% | 42% | 6% |
| 5 | 20% | 40% | 37% | 3% |
| 6 | 26% | 40% | 32% | 2% |
| 7 | 33% | 39% | 27% | 1% |

The adjudication prompt includes a compact version of the current ruleset's table so
the GM understands what a difficulty means (`09-context.md`). The client shows it on
the dice card.

### 3.4 Effect

Effect is **how much** a success accomplishes: `limited`, `standard`, or `great`, with
display names from `effect.labels`.

```
effect = effect.byRating[rating − stats.min]
         + ruling effectModifier (−1…+1) − harm effect penalties + criticalBonus on a critical
         clamped to limited…great, then lowered once per 'reduced-effect' cost
```

- **RUL-040** `effect.byRating` has one entry per rating from `stats.min` to
  `stats.max`. The standard ruleset uses `limited, standard, standard, standard, great`
  for ratings 1–5.
- **RUL-041** The ruling's `effectModifier` reflects tools, scale, and the quality of
  the approach: a crowbar on a door, one person against a mob.
- **RUL-042** A ruleset that does not want effect sets every rating to `standard` and
  every scaling value to 0 (the Two Dice example does this).

**Worked example (the contraption, standard ruleset).** Pumping out a flooding hold,
the GM sets stakes: success "the pump works" ticks `clock.flooding-hold` by 2; partial
adds "it leaks" (reduced effect); failure "it jams and the water rises".

- INT 1, success: base `limited`, the pump half-works: 1 tick.
- INT 5, partial: base `great`, reduced once to `standard`: leaky but workable, 2 ticks.
- INT 5, success: `great`: 3 ticks.

## 4. Rulings and stakes

### 4.1 Direct rulings

- **RUL-050** A direct ruling states the outcome, effect, and consequences, and they are
  applied **as written**, without scaling. The GM chooses effect with the same guide:
  the relevant stat's base effect, adjusted for the situation.
- **RUL-051** A direct ruling may still inflict harm (an attack the PC ignored, a fall),
  and that harm goes through the full harm pipeline (§6).

### 4.2 Roll stakes

| List | Contents | Applied on |
|---|---|---|
| `success` | What the actor **achieves**: progress, harm to opponents, treatment | Critical, success, partial |
| `partial` | **Costs** added to a partial | Partial |
| `failure` | **Costs** of failing | Failure (success items do **not** apply) |

- **RUL-060** Stake descriptions are shown to the player before the roll and MUST NOT
  reveal hidden information (TRN-033).
- **RUL-061** A complication MUST NOT negate a success. "You pick the lock, but it
  doesn't open" is forbidden; "you pick the lock, but the guard's footsteps are close"
  is a complication.

### 4.3 Scaling by effect

Values in stakes are written for **standard** effect. For roll rulings, the engine
adjusts items in the `success` list by the final effect's row in `effect.scaling`:
`harmLevels` and `clockTicks` are added (harm stays between 1 and the fatal level;
ticks stay at least 1), and a treatment removes `treatmentLevels` levels.

The standard ruleset:

| Effect | Harm inflicted | Clock ticks | Treatment removes |
|---|---|---|---|
| Limited | −1 level | −1 | 0 levels (treated only) |
| Standard | as written | as written | 1 level |
| Great | +1 level | +1 | 2 levels |

- **RUL-062** Costs in `partial` and `failure` are never scaled.

### 4.4 Consequence types

| Type | Engine action |
|---|---|
| `progress` | Clock ticks if `clockTicks`; otherwise narrative only |
| `treatment` | Treat the named harm, or the most severe if `harmName` is null (§6.6) |
| `harm` | The harm pipeline (§6) |
| `reduced-effect` | Lowers effect (§3.4) |
| `complication` | Clock ticks if `clockTicks`; otherwise narrative only |
| `lost-opportunity`, `worse-position` | Narrative only |

- **RUL-063** "Narrative only" means the narrator must include it and extraction records
  any facts that result; the engine changes no state.
- **RUL-064** A ruling may introduce up to three clocks. They are created before any
  ticks, so stakes can tick a clock the same ruling creates. A planned clock whose ID
  already exists, or whose segments fall outside `clocks.minSegments…maxSegments`,
  fails semantic validation.

### 4.5 The ruling schema follows the ruleset

- **RUL-065** The ruling schema sent to the model is built for the campaign's ruleset
  (CON-035): stats and harm tags are enums of the ruleset's IDs, and difficulty, harm
  level, clock segments, and ticks are narrowed to its ranges. Constrained decoding
  therefore cannot produce a stat or tag the ruleset lacks.

### 4.6 Who rolls

- **RUL-066** Rolls are player-facing. The roll's `actorId` is the PC, or an NPC acting
  at the PC's direction in the same scene. NPCs acting on their own never roll: what
  they do to the PC arrives as consequences of the PC's roll, or as a direct ruling.
- **RUL-067** There is no initiative, turn order, or grid. In combat, each turn the
  player says what the PC does; the GM rules or calls a roll; enemies' actions land as
  stakes.

## 5. Building the resolution draft

`core` builds the draft (TRN-040) in this exact order. Each step's result is in the
draft so the player can see and override it.

1. **Create planned clocks** (RUL-064).
2. **Roll** (roll rulings): points (§3.2), dice and result (§3.3), effect before costs
   (§3.4).
3. **Select the outcome:** success items unless failure, plus the tier's costs (§4.2).
4. **Apply `reduced-effect` costs**, then **scale** success items (§4.3).
5. **Run each harm consequence** through §6: armor, resistance, placement, lethality.
6. **Apply treatments** (§6.6).
7. **Apply clock ticks** in list order; record completions; resolve completed
   stat-change clocks (§8.3).
8. **Advance time** by `elapsedMinutes` and compute **healing** for every living
   character (§6.6).
9. **Validate** every resulting commit; list failures in `invalidConsequences`
   (TRN-045).

- **RUL-070** Draft building is deterministic given the ruling, state, ruleset, and the
  dice the `Rng` returns. Tests drive it with scripted dice.
- **RUL-071** A reroll re-runs the steps from that roll onward with fresh dice. Setting
  the outcome re-runs from step 3, and editing consequences from step 5, keeping the
  dice.
- **RUL-072** Accepting the draft writes the resolution set in this order:
  `clock.create`, `roll.record` (action, then each resistance), `resolution.record`,
  `harm.mitigate`, `status.add` and `status.update` from harm and treatment,
  `entity.death`, `clock.tick`, `stat.change` and `clock.delete` for completed
  stat-change clocks, `time.advance`, healing `status.update` and `status.remove`, and
  `override.record` if overridden.

## 6. Harm

There are no hit points. Harm is a named status with a level, like *Deep Cut to Arm*,
and one or more tags from the ruleset's `harm.tags`. The ruleset's `harm.levels` lists
the levels from least to most severe; harm above the last level is fatal
(`harm.fatalName`).

The standard ruleset has three tags (physical, mental, social), so a romance can wound
as surely as a knife, and three levels:

| Level | Capacity | Penalty on hindered rolls | Heals untreated | Heals treated | Examples |
|---|---|---|---|---|---|
| 1 Lesser | 2 | −1 effect (once) | 1 day | 12 hours | Bruised, Shaken, Embarrassed |
| 2 Moderate | 2 | −1 point each | 1 week | 3 days | Deep Cut, Terrified, Heartbroken |
| 3 Severe | 1 | −2 points each; incapacitating | never | 1 week | Stabbed Through, Shattered, Disgraced |
| 4 Fatal | — | — | — | — | |

### 6.1 Harm pipeline

For each harm consequence: scale (§4.3) → **armor** → **resistance** → **placement** →
**lethality**. Each step is recorded in the draft's `harmResults`.

### 6.2 Armor

- **RUL-080** A `harm-reduction` bonus on an item the target wears lowers incoming harm
  with a matching tag by its `levels`, before resistance, if the item has uses left this
  scene (`usesPerScene`; unlimited when absent). At most `items.maxArmorPerHarm` items
  apply to one harm.
- **RUL-081** Each use is recorded as `harm.mitigate` with `source: 'armor'`. Uses per
  scene are counted from these commits since the last `scene.start`.

### 6.3 Resistance

- **RUL-082** When `resistance.mode` is `auto`, harm is resisted automatically: for the
  PC only when `resistance.who` is `pc`, or for every character when it is `everyone`.
  When `off`, harm lands as planned.
- **RUL-083** The stat rolled is the `resistStat` of the harm's first tag. A tag with
  `resistStat: null` cannot be resisted.
- **RUL-084** A resistance roll uses the ruleset's dice method with points equal to the
  stat's rating plus any resistance bonuses (RUL-087): no difficulty and no harm
  penalties. Its result removes the levels given by `resistance.reduction`; `negate`
  removes the harm entirely.
- **RUL-085** Each resistance roll is recorded as `roll.record` (`purpose:
  'resistance'`, `effect: null`) and as `harm.mitigate` (`source: 'resistance'`).
- **RUL-087** A `resistance` bonus on an item the target is wearing or holding adds its
  points to resistance rolls against harm with a matching tag (a warm coat against cold,
  a charm against fear). Resistance bonuses share the `items.maxRollBonus` cap and are
  recorded as labeled modifiers.

The standard ruleset resists physical and mental harm with END and social harm with
CHA. Its reduction table and the resulting odds:

| Result | Levels removed |
|---|---|
| Critical | All (negated) |
| Success | 2 |
| Partial | 1 |
| Failure | 0 |

| Resistance stat | Critical | Success | Partial | Failure |
|---|---|---|---|---|
| 1 | — | 17% | 33% | 50% |
| 2 | 3% | 28% | 44% | 25% |
| 3 | 7% | 35% | 45% | 13% |
| 4 | 13% | 39% | 42% | 6% |
| 5 | 20% | 40% | 37% | 3% |

**Worked example (the stabbing, standard ruleset).** A cutthroat's knife is a failure
cost: *Stabbed in the Side*, severe (3), physical. The PC has END 2 and rolls 5 and 2:
a partial, one level removed. It lands as *Stabbed in the Side*, moderate (2).

### 6.4 Penalties

A harm **hinders** a stat when one of its tags lists that stat in `hinders`. On a roll
with a hindered stat:

- **RUL-090** Each hindering harm subtracts its level's `pointPenalty`.
- **RUL-091** For each level that has at least one hindering harm, the level's
  `effectPenalty` is subtracted from effect once.
- **RUL-092** A level marked `incapacitating` tells the GM the character cannot act in
  ways the harm prevents without help. The engine adds no further penalty.
- **RUL-093** Harm penalties never apply to resistance rolls. Permanent statuses and
  non-harm conditions carry no automatic penalty; the GM accounts for them in
  difficulty.

### 6.5 Placement, overflow, and lethality

- **RUL-100** With `harm.overflow: 'up'`, harm placed at a full level (its `capacity`
  reached) moves up a level, repeating until it finds room; a `null` capacity is never
  full. With `'none'`, capacity is ignored. Above the last level, harm is **fatal**.
- **RUL-101** Fatal harm follows the ruleset's `lethality` for the target:

| Lethality | Fatal harm becomes |
|---|---|
| `lethal` | Harm at the fatal level, and `entity.death` |
| `heroic` | Harm at the last level (even if full), plus a **permanent** condition named after it, e.g. *Lasting: Stabbed in the Side* |
| `none` | Harm at the last level (even if full); nothing permanent |

- **RUL-102** When fatal harm is survived, the narrator is told to describe a lasting
  consequence (a scar, a limp, capture). The player can rename the permanent condition.
- **RUL-103** Planned harm at the fatal level goes through the same pipeline, so armor
  and resistance can still save the target.
- **RUL-104** Permanent statuses never heal and do not occupy capacity.

### 6.6 Healing and treatment

- **RUL-110** Harm heals one level per interval of game time, measured from its
  `changedAt`. The interval is the level's `treatedHealMinutes` if the harm is
  `treated`, otherwise `untreatedHealMinutes`. `null` means that level does not heal
  that way. Healing below the first level removes the status.
- **RUL-111** Healing is computed whenever the engine advances time: in the resolution
  set, and appended to any player edit that advances time. Leftover time carries over,
  so a long time skip can heal several levels.
- **RUL-112** A treatment marks the harm `treated`, removes levels per effect (§4.3),
  and resets `changedAt`.
- **RUL-113** Dead characters and fatal-level harm do not heal.

### 6.7 Death

- **RUL-120** A dead character's `lifeState` is `dead`. Their wiki page, observations,
  and relationships remain, so others still remember, grieve, or resent them.
- **RUL-121** When the PC dies, the turn completes normally, and the client shows a
  death screen offering to rewind or edit the turn. While the PC is dead, in-character
  input is rejected with `illegal_state_change`; OOC input is allowed. Continuing with a
  new PC is a later feature.
- **RUL-122** The draft shows deaths before acceptance, so the player can override.

## 7. Clocks

A clock is a circle of segments that fills as something progresses: *Guard Alertness
2/6*, *Odette's Trust Thaws 3/8*.

- **RUL-130** Kinds: `progress` (a danger, a project, a slow-burn romance, a faction's
  plot) and `stat-change` (§8.3). Segments stay within the ruleset's
  `clocks.minSegments…maxSegments`, and a planned tick is at most `clocks.maxTicks`
  before scaling.
- **RUL-131** Clocks are created by rulings, world ticks (`12-time-world.md`), or the
  player. When `ownership.clocks` is `narrative`, extraction may also create, tick, and
  delete them.
- **RUL-132** Ticks clamp to 0…segments. A clock completes when a tick fills it from
  below; ticking a full clock does nothing more.
- **RUL-133** Completed clocks stay until deleted, and the adjudication context lists
  them so the GM can bring the consequence into play.
- **RUL-134** `gm` clocks are hidden truth: they and their ticks are omitted from
  everything sent to the client outside GM mode, including the draft's `clockResults`.

## 8. Other ruleset sections

### 8.1 Ownership

| `ownership.statuses` / `.clocks` | Changed by |
|---|---|
| `authoritative` | Resolution, world ticks, and player edits only |
| `narrative` | The above, plus extraction |

- **RUL-140** In either mode, rolls, armor, resistance, placement, lethality, and
  healing behave the same; narrative mode only adds extraction as a writer.

### 8.2 Relationships

- **RUL-141** Relationship dimensions come from `relationships.dimensions`, and values
  stay within `relationships.min…max`. One turn changes a dimension by at most
  `maxChangePerTurn` (extraction and world ticks; player edits are exempt). The
  standard ruleset uses −5…+5 with at most 3 per turn.
- **RUL-145** `relationships.trackPc` decides whether extraction may also record the
  PC's feelings toward others (`auto`) or only the player sets them (`off`). See
  MEM-064.

### 8.3 Stat change

- **RUL-142** When `statChange.enabled`, sustained effort or neglect creates a
  `stat-change` clock with `statChange.clockSegments` segments. The GM marks effort with
  a `progress` consequence on the clock, and the engine sets its ticks from the action's
  elapsed time: `round(elapsed weeks × ticksPerWeek)` (TIME-091). `clocks.maxTicks` does
  not apply. The standard ruleset uses 8 segments and 1 tick per week: an afternoon's
  training earns nothing, a month 4 ticks, two months completes the clock.
- **RUL-143** When a stat-change clock completes, the same resolution set applies
  `stat.change` by `statChange.amount` (clamped by RUL-010) and deletes the clock. At
  the limit, the clock is deleted without a change, and the draft says so.
- **RUL-144** A character has at most one stat-change clock per stat and direction.

### 8.4 Carrying

Carrying is defined in `11-gear.md` §5. The ruleset chooses `containers` (size points
per item size) or `encumbrance` (capacity from `baseCapacity`, `capacityPerPoint`, and
`capacityStat`; an `encumberedStatus` while over; an optional `hardLimitMultiplier`).
Each harm tag's `visible` flag decides whether others can see that harm (GEAR-061).

## 9. Model guidance from the ruleset

- **RUL-150** The adjudication template renders the ruleset for the GM: stat names and
  descriptions, the difficulty guide, the result and effect labels, a compact odds
  table, harm tags and levels with their examples and incapacitating flags, and the
  stat-change pace. A ruleset's descriptions are therefore part of its game design,
  and authoring them well matters as much as the numbers.

## 10. Core functions

`packages/core/src/rules/`. Names are suggestions; behavior is normative.

| Function | Does |
|---|---|
| `rulesetIssues(ruleset)` | Every cross-field problem (§12) |
| `rulingLimitsFor(ruleset)` | The `RulingLimits` for the model-facing schema (RUL-065) |
| `diceToRoll(points, dice)` | How many dice, and which to keep (RUL-030) |
| `readDice(dice, points, rules)` | Kept dice, total, and result (§3.3) |
| `odds(points, rules)` | Exact probabilities by dynamic programming over dice (for the UI, prompts, and tests) |
| `harmPenalties(statuses, stat, ruleset)` | Point and effect modifiers (§6.4) |
| `actionRoll(…)`, `resistanceRoll(…)` | A complete `Roll` |
| `selectOutcome(stakes, result, effect, ruleset)` | Final effect and applied consequences (§4.2, §4.3) |
| `processHarm(…)` | One `HarmResult` (§6) |
| `placeHarm(statuses, level, ruleset, lethality)` | Placement and outcome (§6.5) |
| `heal(statuses, now, ruleset)` | Healing changes (§6.6) |
| `tickClock(filled, segments, ticks)` | Clamped tick and completion (§7) |
| `buildDraft(ruling, state, ruleset, rng)` | The full draft (§5) |
| `draftCommits(draft, state)` | The resolution set's commits (RUL-072) |

- **RUL-151** `odds` MUST be exact (no sampling) and fast for any valid ruleset: up to
  `maxPool` 30 and 100-sided dice.

## 11. Standard ruleset

`ruleset.standard` in the built-in library is the file
`spec/fixtures/library/rulesets/ruleset.standard.json`. It is the source of every "standard
ruleset" value in this document; if the two ever disagree, the fixture wins and this
document is corrected.

| Section | Standard value |
|---|---|
| Stats | STR, END, DEX, INT, CHA, rated 1–5, default 2; PC creation 15 points, each 1–4 |
| Dice | Pool of d6, highest die; 6 success, 4–5 partial, 1–3 failure; two 6s critical; empty pool rolls 2, keeps lowest; at most 10 dice |
| Difficulty | −3…+3; opposed baseline 3 |
| Effect | limited, standard, standard, standard, great; critical +1; scaling as in §4.3 |
| Items | Roll bonus at most +2 per roll; one armor per harm |
| Harm | Tags physical (visible), mental, social; levels and healing as in §6; overflow up |
| Resistance | Automatic for the PC; END for physical and mental, CHA for social; table in §6.3 |
| Lethality | PC heroic, NPCs lethal |
| Clocks | 2–12 segments; at most 3 ticks per consequence |
| Stat change | Enabled; 8 segments; 1 tick per week; ±1 |
| Relationships | Trust, affection, respect, fear; −5…+5; at most 3 per turn; PC's side set by the player (`trackPc: off`) |
| Carrying | Containers; sizes tiny 1, small 2, medium 4, large 8, huge 16 |

## 12. Ruleset checks

`rulesetIssues` reports every problem a schema cannot express (SCH-062):

- Stat IDs, harm tag IDs, and relationship dimension IDs are unique.
- `stats.min` is below `stats.max`; `stats.default` is inside the range;
  `effect.byRating` has exactly one entry per rating and never decreases.
- The PC creation range sits inside the stat range, and `statPoints` is achievable.
- The difficulty range includes 0, and every guide value is inside it.
- Bands are ordered highest `min` first without repeats; `critical.face` and
  `successOn` do not exceed `sides`; a pool's `maxPool` is at least `stats.max`.
- Every stat named in `hinders`, `resistStat`, and `capacityStat` exists.
- Clock segment limits are ordered, and `statChange.clockSegments` is within them.
- `relationships.min` is 0 or below, and `maxChangePerTurn` fits in the range.

## 13. Required tests

- **RUL-160** The standard ruleset reproduces the tables in §3.3 and §6.3 exactly, and
  every ruleset's odds sum to 1 for every points value.
- **RUL-161** An empty pool that keeps one die never produces a two-face critical.
- **RUL-162** The worked examples (arm wrestling, the contraption, the stabbing)
  produce the stated pools, effects, and harm levels with scripted dice.
- **RUL-163** Item points cap at `maxRollBonus`, and a capped item shows its capped
  value.
- **RUL-164** Harm penalties: per-harm point penalties, once-per-level effect
  penalties, irrelevant tags ignored, resistance unaffected.
- **RUL-165** Overflow, `null` capacity, `overflow: 'none'`, each lethality setting, and
  permanent statuses taking no capacity.
- **RUL-166** Healing: untreated, treated, never-heals, carry-over, permanent, fatal.
- **RUL-167** Clocks clamp and complete once; stat-change clocks change the stat or are
  deleted at the limit.
- **RUL-168** Draft order and commit order are as specified; a reroll re-runs only the
  later steps.
- **RUL-169** Each Appendix A ruleset passes `rulesetIssues` and matches its odds
  table; a deliberately broken ruleset reports every one of its problems.

## Appendix A. Example rulesets

These ship in the built-in library alongside the standard ruleset, as the fixture files
`spec/fixtures/library/rulesets/ruleset.<name>.json`. They exist to prove the building blocks
and serve as test fixtures. Read the fixture file only when a task needs it.

### A.1 Two Dice (`ruleset.two-dice`)

2d6 plus a stat from −1 to +3: 10+ is a strong hit, 7–9 a weak hit, 6 or less a miss.
Four stats (Grit, Grace, Wits, Heart), no effect differences, no resistance, and two
harm levels before dying.

| Stat + modifiers | Critical | Strong hit | Weak hit | Miss |
|---|---|---|---|---|
| -1 | — | 8% | 33% | 58% |
| 0 | — | 17% | 42% | 42% |
| 1 | — | 28% | 44% | 28% |
| 2 | — | 42% | 42% | 17% |
| 3 | — | 58% | 33% | 8% |

### A.2 Heroic d20 (`ruleset.d20`)

d20 plus a stat from 0 to 5: 15+ succeeds, 10–14 succeeds with a cost, and a natural
20 is always a critical. The standard stats and harm.

| Stat + modifiers | Critical | Success | Partial | Failure |
|---|---|---|---|---|
| 0 | 5% | 25% | 25% | 45% |
| 2 | 5% | 35% | 25% | 35% |
| 4 | 5% | 45% | 25% | 25% |
| 5 | 5% | 50% | 25% | 20% |

### A.3 d10 Pool (`ruleset.d10-pool`)

A d10 per point; each 8+ is a success. One success is a partial, two a success, four a
critical. An empty pool rolls one die and keeps it.

| Dice (points) | Critical | Success | Partial | Failure |
|---|---|---|---|---|
| 1 | — | — | 30% | 70% |
| 2 | — | 9% | 42% | 49% |
| 3 | — | 22% | 44% | 34% |
| 4 | 1% | 34% | 41% | 24% |
| 5 | 3% | 44% | 36% | 17% |
| 6 | 7% | 51% | 30% | 12% |
