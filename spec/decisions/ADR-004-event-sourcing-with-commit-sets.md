# ADR-004: Event sourcing with commit sets per stage

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** ARCH-040 to ARCH-045, TRN-060 to TRN-067, TRN-085

## Context

Player authority is the top design pillar: the player can veto, edit, regenerate, or
rewind any output, including a single stage of an old turn, without losing what came
after. The context inspector must show where every fact came from.

## Decision

- All campaign history is an append-only log of **commits**. Everything else is a
  projection that a single command rebuilds.
- Commits are grouped into **commit sets**, one per stage of a turn: setup, input,
  adjudication, resolution, narration, extraction, world-tick, consolidation, and
  player-edit.
- Editing or regenerating a stage writes a new set that **supersedes** the old one;
  old sets remain as versions. A set records the sets it was **based on**, so
  superseding one makes its dependents **stale** until regenerated or kept.
- State at any **read point** is a pure fold over the active sets in a branch's
  ancestry. Snapshots every 25 turns are caches.

## Consequences

- Any stage can be edited, regenerated, restored, or kept, with full history.
- Provenance is exact: the inspector can show which set produced which fact.
- Replay is deterministic, because dice record their values (CONV-062) and folding is
  pure.
- The turn engine carries real complexity (supersession, staleness, folding). It lives
  in pure `core` code with focused tests (`turn-logic.ts` in the reference code).
- The log only grows. For a single-player text game the size is small.

## Alternatives considered

- **Mutable state with an undo stack.** Cannot edit an old stage and keep later
  turns, and cannot support branches.
- **A full state snapshot per turn.** Simple reads, but no per-stage provenance and
  heavy storage.
