# ADR-009: World ticks run after extraction

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** TIME-051, TIME-052, TIME-055, TIME-056, TRN-046, TRN-086

## Context

When game time passes, off-screen characters act in world ticks, every
`worldTickMinutes` (480 by default). An early design ran ticks before narration so the
narrator could mention their results. But ticks depend on what happened in the turn,
which is only known after extraction, and ticks computed before narration conflicted
on replay when narration or extraction was later edited.

## Decision

- A turn's world ticks run after its extraction, as world-tick sets based on its
  resolution and extraction sets.
- The next action waits for the ticks as well as extraction (ARCH-070).
- Tick results reach the player as an off-screen news card and enter the next turn's
  context.

## Consequences

- Ticks see the turn's real outcome, and staleness flows through `basedOnSetIds` like
  any other stage.
- News arrives just after narration rather than inside it.
- After a long time skip the next action waits longer. The number of periods is capped
  (`world.maxFineTicks`, default 3; `world.maxCoarsePeriods`, default 5) to bound it.
