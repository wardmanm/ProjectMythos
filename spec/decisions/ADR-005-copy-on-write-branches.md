# ADR-005: Branches as a turn tree with copy-on-write

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** TRN-100 to TRN-116, TRN-142

## Context

The player can fork a timeline and play both sides. Editing a turn that belongs to
more than one branch must never change the other branch. The owner asked for this to
happen automatically rather than by prompting.

## Decision

- Turns form a tree. A branch is a pointer to a head turn; `branch_turns` lists each
  branch's ancestry and is maintained incrementally.
- Any operation that would create a set on a **shared** turn first copies the turn
  and its descendants on the current branch (**auto-fork**). The copy remaps every ID
  the copied commits define (observations, statuses, grants) in two passes, so
  references inside the copy point at the copy.
- Entity and clock IDs are never remapped: the same character in two timelines is the
  same entity (TRN-115).
- Rewrite and rewind first archive the old timeline as a branch, so nothing is lost.

## Consequences

- Branches are isolated exactly, and every query takes a read point.
- Copying costs time proportional to the turns copied. It happens only when editing a
  shared turn.
- The remap must know every commit type that defines an ID. An exhaustive `switch` in
  the remap function makes a new commit type a compile error until it is handled.

## Alternatives considered

- **Editing shared turns in place with per-branch overrides.** No copying, but every
  read would merge overrides.
- **Copying the whole campaign per fork.** Simple, but heavy, and it loses the shared
  history the timeline view draws.
