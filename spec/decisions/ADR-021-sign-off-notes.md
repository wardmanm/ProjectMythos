# ADR-021: What the owner notices during a sign-off is filed without leaving it

- **Status:** Accepted
- **Date:** 2026-11-06
- **Requirements:** CONV-137, CONV-140, CONV-141

## Context

During a sign-off (ADR-019), the owner tries each check in turn. Along the way they
notice things that fail no check: a bug in another part of the app, something that
works but should work differently, an idea for something new. ADR-019 gave these
nowhere to go but the status log's Loose ends, which is not on the board and has no
Priority. Raising them in the `/docs close` session would interrupt the walk-through
and mix them up with the checks' results.

The owner built the same thing for another project, rollcall_derby, as a second
Claude Code session that runs beside the release session, and wants it here.

## Decision

- `/sign-off-notes`, a skill only the owner starts, runs in a second Claude Code
  window open in the same checkout as `/docs close`. Each message that starts `Bug -`,
  `Change -`, or `Feat -` is a note (CONV-141).
- Each note becomes a GitHub issue once the owner confirms its title and Priority. It
  is labeled `sign-off`, and `bug` for a bug or `enhancement` for a change or a
  feature. It names the spec section and requirement it concerns, or `new`, and the
  check that was in progress when it was noticed.
- A note is `P1` or `P2`, never `P0`. A P1 goes in the next phase's milestone and a P2
  in none, so a note never holds back the release being signed off.
- The phase plan lists the issues under **Found while testing**, below the Sign-off
  table. The second window writes that list and nothing else; the checks and the table
  belong to `/docs close`.
- A note that means a check's Expect did not happen, whether the check is in progress,
  still to come, or already passed, is a failure of that check, and so is a note that
  should block the release. The second window does not file it: it tells the owner
  what to say in the `/docs close` window, which can run a check again or add one.
- The release notes' known issues include the P1 bugs on the list (CONV-137). When the
  next phase plan is written, its open P1 bugs become tasks (CONV-140), and the owner
  decides which open P1 changes and features it takes on.

This extends ADR-019, which made GitHub the record for one thing, bugs. GitHub is now
also the record for the changes and features noticed during a sign-off, until a phase
takes one on and the spec is amended for it. ADR-018 still governs task issues.

## Consequences

- The owner files what they notice when they notice it, with a Priority, without
  breaking off the walk-through.
- Nothing filed this way can block a release, so a note never needs a fix before the
  phase ships. A blocker still goes through a check.
- Two sessions write the same phase plan, so each reads it again just before an edit.
  The list is committed with the table's sign-off commit.
- A change or feature filed this way is a request, not a decision: taking it on still
  changes scope, which the owner decides when a phase plan is written.

## Alternatives considered

- **Loose ends in the status log.** What ADR-019 allowed. It has no Priority and no
  card on the board, and `/status` only writes it on `main` between tasks.
- **Raising each note in the `/docs close` session.** One window, but each note
  interrupts the check in progress, and the session's questions are about results.
- **Putting notes in the phase's milestone.** The milestone holds the phase's own work
  and closes at its release, with the notes still open in it. They are work for a later
  phase.
