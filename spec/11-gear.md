---
doc: 11-gear
title: Mythos — Gear
status: draft
schemaVersion: 1
requirementPrefix: GEAR
---

# Gear

> **For Claude:** item and slot shapes are in `03-contracts.md` §6 (`ItemSchema`,
> `ItemLocationSchema`, `ContainerSchema`, `ItemBonusSchema`) and `04-content-schemas.md`
> §5 (slot schemas). This document defines what they mean. Gear logic is pure `core`
> code. The appearance, carrying, and move-validation rules were validated with a
> reference implementation.

What a character wears shapes how others see them, what they carry limits what they
can do, and what they hide stays hidden until the story reveals it. How strict
carrying is depends on the ruleset; how detailed clothing is depends on the slot schema.

## 1. Principles

- **Gear is visible state.** Other characters see a character through their visible
  gear, so it feeds appearance, public blocks, NPC memories, and (later) portraits.
- **Hidden means hidden.** A concealed item appears in no one's prompt but the
  possessor's and the adjudicator's, until the fiction reveals it.
- **Strict or loose by configuration.** The same engine supports "carry anything until
  it's too heavy" and "pockets and hands, unless you find a bag".

## 2. Slots and layers

The campaign's **slot schema** comes from the tone profile if it sets one, otherwise
from the setting (SCH-040).

- **GEAR-001** A slot (head, torso, clothes…) has one or more **layers**, outermost
  first. Each layer is `visible` or `concealed`, and holds up to `itemsPerLayer` items.
  Items in a concealed layer are concealed.
- **GEAR-002** An item can be worn only in a slot listed in its `wearable.slots`, at a
  layer that exists, with room in that layer.
- **GEAR-003** While worn, an item hides every item in the slots listed in its
  `wearable.covers`: a cloak with `covers: ["neck"]` hides a locket at the neck. Covered
  items are concealed whatever their layer.
- **GEAR-004** `heldItems` (slot schema) is the number of free hands. A `large` or
  `huge` item takes two.

Slot schemas can be as detailed as a setting wants. The everyday schema in the
reference pack has six slots, with outer and under layers on torso and legs. At the
other extreme, this is a complete, valid schema:

```json
{
  "schemaVersion": 1,
  "id": "slots.simple",
  "name": "Simple",
  "slots": [
    { "id": "clothes", "name": "Clothes", "layers": [
      { "name": "outer", "visibility": "visible" },
      { "name": "under", "visibility": "concealed" }
    ], "itemsPerLayer": 3 }
  ],
  "heldItems": 2
}
```

## 3. Where items are

- **GEAR-010** Every item has exactly one location (`ItemLocation`): `worn` (slot and
  layer), `held`, `carried` (encumbrance mode only), `contained` in another item,
  `placed` in a place, or `gone` (used up or destroyed).
- **GEAR-011** An item's **possessor** is the character who has it on them: the wearer,
  holder, or carrier, following containers outward (a coin in a purse in a pack worn by
  Wren is Wren's).
- **GEAR-012** **Ownership** is separate from possession. `ownerId` is who the item
  belongs to. A gift changes both; a theft changes only possession, so the owner (and
  the story) remembers it was stolen. Extraction changes ownership only when the fiction
  does (MEM-054).
- **GEAR-013** `quantity` makes an item a **stack** of identical units (15 healing
  draughts). Weight and size are per unit. Using some changes the quantity
  (`item.quantity`); reaching 0 makes the item `gone`. Splitting a stack (giving 5
  away) creates a new item with that quantity and lowers the original; extraction does
  both in one output.

## 4. Concealment and discovery

- **GEAR-030** An item is **concealed** if it is in a concealed layer, in a covered slot,
  inside a container, or (encumbrance mode) carried and not bulky. Everything else the
  character has on them is visible.
- **GEAR-031** The possessor always knows their own concealed items. Anyone else knows
  about one only through memory: they saw it before it was hidden, saw it drawn, found
  it, or were told.
- **GEAR-032** Discovery is fiction. A frisk, a search, a fall, or drawing a weapon is
  narrated, and extraction records what was perceived ("the guard found a knife in
  Wren's boot", witnessed by the guard) and any move (the knife confiscated: placed, or
  held by the guard, owner unchanged).
- **GEAR-033** Which prompts see concealed items is set by CTX §7: the PC's are in the
  adjudicator's and narrator's state tier, marked "mention only if the fiction makes it
  relevant"; an NPC's are seen by the adjudicator and that NPC's own voice call only.

**Example (the checkpoint).** Wren, the knife under her trousers, walks up to a guard
post. The adjudicator sees the knife and the guard's habits, and calls a DEX roll to
keep it unnoticed during the pat-down, with stakes on failure: "the guard finds the
knife". The narrator knows about the knife and mentions it because it matters now. On
a failure, extraction records that the guard found it, and the knife moves to the
guard's hand.

## 5. Carrying

The ruleset's `carrying.mode` chooses one of two models.

### 5.1 Containers mode

"You have pockets and hands. You're not carrying fifteen potions unless you find a bag."

- **GEAR-040** Items go in hands (GEAR-004), on the body (worn), or in containers.
  `carried` is not allowed.
- **GEAR-041** A container has a `capacity` in **size points** and a `maxItemSize`.
  An item fits if its size is at most `maxItemSize` and the points used (each item's
  size points × quantity, from the ruleset's `sizePoints`) stay within capacity. The
  standard sizes are tiny 1, small 2, medium 4, large 8, huge 16.
- **GEAR-042** Pockets are containers that are part of clothing: wool trousers with
  `container: { capacity: 2, maxItemSize: "small" }` hold a knife or two coins, never a
  sword.
- **GEAR-043** In this mode every item needs a `size`. An item without one cannot be
  put in a container until it has one; extraction is told to give sizes to new items.

### 5.2 Encumbrance mode

"Carry fifteen short swords without a backpack, as long as you're not over the limit."

- **GEAR-050** Items can be `carried` without containers. A character's **load** is the
  total weight (× quantity) of everything they possess, worn and contained included.
- **GEAR-051** Capacity is `baseCapacity + capacityPerPoint × rating` of the ruleset's
  `capacityStat`. While load exceeds capacity, the engine keeps the ruleset's
  `encumberedStatus` condition on the character, adding and removing it in the same
  set as the change that crossed the line. The condition has no automatic mechanics;
  the GM accounts for it (RUL-093).
- **GEAR-052** If `hardLimitMultiplier` is set, a move that would push load past
  `capacity × hardLimitMultiplier` is illegal.

### 5.3 Validation

- **GEAR-053** Every item move is checked: the destination exists; slot, layer, and
  room (GEAR-002); free hands (GEAR-004); `carried` only in encumbrance mode; container
  size and capacity (GEAR-041); no item inside itself, however deeply; and the hard
  limit (GEAR-052). Every failure is reported with a plain-English reason ("wool
  trousers has room for 1 more; dagger needs 2").
- **GEAR-054** Failures in extraction are semantic issues fed back to the model
  (MEM-061); in a resolution draft they appear in `invalidConsequences`; in a player
  edit they reject the edit with the reasons.

## 6. Appearance

- **GEAR-060** A character's **appearance** is built by code, deterministically, from:
  their physical description; visible worn items, in slot-schema order, outermost
  layer first, skipping covered slots; held items; `large` and `huge` carried items
  (encumbrance mode); and visible harm.
- **GEAR-061** Harm is visible to others if any of its tags is marked `visible` in the
  ruleset (`harm.tags[].visible`). The standard ruleset makes physical harm visible
  and mental and social harm invisible: a split lip shows, being shaken doesn't.
- **GEAR-062** Appearance is plain text in a fixed shape: *"Slight, freckled,
  rain-soaked. Wearing: long oilskin cloak, wool trousers, boots. Holding: lantern.
  Visibly hurt: split lip."* Items are listed by name (GEAR-065), and a stack shows its
  quantity ("torch (3)").
- **GEAR-063** Appearance is the visible part of a character's public block (CTX §6.1).
  Because it is deterministic, it changes only when gear or visible harm changes,
  which keeps the prompt prefix stable (CTX-013).
- **GEAR-064** What others notice about appearance becomes memory through extraction:
  "a woman in an oilskin cloak asked about the Merrow" lets the harbor clerk recognize
  her later.
- **GEAR-065** Item names are written as they read in a list: lowercase, no article,
  and singular for a stack (`fishing knife`, `wool trousers`, `torch`). Proper nouns
  keep their capitals (`Jory's letter`). Appearance, validation messages (GEAR-053), and
  the inventory all use names as written, and extraction is told the same rule for the
  items it creates.

## 7. Gear and rules

- **GEAR-070** A `roll` bonus adds points to a roll when the item is listed in the
  ruling's `itemIds` (RUL-023). Items never change stats.
- **GEAR-071** A `harm-reduction` bonus is armor (RUL-080); a `resistance` bonus adds
  points to resistance rolls against its tags (RUL-087). Both apply only to items the
  target is wearing or holding.

## 8. Managing gear in the UI

- **GEAR-080** The gear view lets the player equip, remove, move between containers,
  drop, and split stacks directly. Each change is a player-edit `item.move` or
  `item.quantity` at the branch head: instant, no narration, no game time, and
  validated by §5.3.
- **GEAR-081** Each action also offers **"do it in the story"**, which fills the input
  with the action ("I put on the oilskin cloak") for the player to submit as a normal
  turn, when it should take time or be seen.

## 9. Changing slot schemas

- **GEAR-090** If a campaign's slot schema lacks a slot an authored item is worn in, at
  creation the item moves to the first container the character has that fits it,
  otherwise to their hands if free, otherwise placed at their location, with a warning
  in the setup turn.

## 10. Phase delivery and tests

Phase 6 delivers this document, except: the pure checks and appearance in `core`
arrive in phase 1, where pack loading validates starting items and the narrator's
scene tier shows appearance; stacks and ownership in extraction arrive with extraction
in phase 4.

- **GEAR-100** Appearance: visible layers only; covered slots hidden; held and bulky
  items; visible harm by tag; deterministic text.
- **GEAR-101** The concealed set is exactly: concealed layers, covered slots,
  containers' contents, and (encumbrance) non-bulky carried items.
- **GEAR-102** Containers: size limit, capacity with quantities, pockets that hold a
  knife but not a sword, a pack that refuses fifteen potions.
- **GEAR-103** Hands, layers, wearable slots, and containment cycles are refused with
  their reasons.
- **GEAR-104** Encumbrance: load and capacity; the encumbered condition added and
  removed in the crossing set; the hard limit.
- **GEAR-105** A theft changes possession but not ownership; a gift changes both.

## Decisions

| Question | Decision | Rejected and why | Decided by |
|---|---|---|---|
| What does GEAR-053's "the destination exists" cover in `validateItemMove`? | Slots and containers, which are gear's own data. Whether a character or place named by the move exists is an entity reference, which commit validation (P1-T05) and the pack loader (P1-T08) check. | Checking characters and places in `validateItemMove` too: it is given no places, and a missing reference would be reported twice. | Claude (ruling) |
| How does the hard limit (GEAR-052) weigh a move? | By the load of whoever has the item after the move, counting everything inside a moved container (GEAR-050). The move is refused if that load is above `capacity × hardLimitMultiplier`, so a character already over the limit can still drop or place things, but not rearrange what they carry. | Refusing only moves that raise the load: the pack loader checks each starting item as a move to where it already is, so an over-limit starting inventory would pass. Counting only the moved item's own weight, as the reference did: a full pack would move as if empty. | Claude (ruling) |
