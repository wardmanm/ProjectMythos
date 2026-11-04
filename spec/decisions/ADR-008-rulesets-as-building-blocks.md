# ADR-008: Rulesets composed from fixed building blocks

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** RUL-001, RUL-002, SCH §7

## Context

The owner wants every part of the rules to be configurable: dice pools, how results
are read, harm, healing, lethality, clocks. A hardcoded system fails that. A scripting
language would make rulesets unsafe to share and hard to maintain.

## Decision

- A ruleset is a JSON file that chooses and configures **building blocks**: dice
  methods (`pool-highest`, `pool-count`, `sum`), result bands, criticals, the empty
  pool, difficulty, effect by rating and scaling, harm tags and levels, resistance,
  lethality, clocks, stat change, relationships, and carrying.
- A small set of things is fixed in the engine (07-rules §1): one action roll per
  turn, four result tiers, three effect levels, the stakes structure, and the harm
  pipeline order.
- `rulesetIssues` checks every ruleset before use. Four fixture rulesets (standard,
  two-dice, d20, d10-pool) prove the range.
- A mechanism outside the blocks is a code change with an ADR (RUL-001). A new ruleset
  is never a code change.

## Consequences

- Very different games run on the same engine, and rulesets can be shared safely.
- Prompts and the UI read the ruleset, so labels and guidance follow it.
- Some systems cannot be expressed (exploding dice, multiple rolls per turn) until a
  block is added.

## Alternatives considered

- **Embedded scripting (Lua or sandboxed JavaScript).** Unlimited, but sandboxing,
  debugging, and validation become the project.
- **One hardcoded system.** Fails the requirement.
