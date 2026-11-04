# ADR-007: Separate adjudication, resolution, and narration

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** TRN-030 to TRN-057, ARCH-071, ARCH-072

## Context

Fiction comes first, but the engine owns mechanics. Local models are unreliable at
holding rule logic and good prose in one generation, and the player wants to accept,
reroll, or override a ruling before the story commits to it.

## Decision

Each turn runs:

1. **Adjudicate:** a structured model call returns a ruling: a roll with stat,
   difficulty, and stakes, or a direct outcome from the fiction, plus elapsed time.
2. **Resolve:** pure `core` code rolls dice with an injected `Rng` and builds a
   resolution draft. The player may accept, reroll, or override it.
3. **Narrate:** a streamed call describes the resolved outcome. It never decides
   mechanics.
4. **Extract:** a background structured call turns what happened into commits.

## Consequences

- Mechanics are deterministic and auditable, and the player can intervene between
  steps.
- Each model call has one focused job, which suits small local models.
- A rolled turn makes two interactive calls. Narration streams, and a direct ruling
  with no roll and no confirmation skips the wait (ARCH-071).
- The narrator can still contradict the outcome. Prompts forbid it, and the player can
  edit or regenerate.

## Alternatives considered

- **One call that rules and narrates.** Fewer calls, but mechanics drift and the
  player cannot veto before the prose exists.
- **A GM that calls dice tools mid-generation.** Weak on local models and hard to edit
  afterwards.
