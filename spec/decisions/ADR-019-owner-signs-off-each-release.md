# ADR-019: The owner signs off each feature before a release

- **Status:** Accepted
- **Date:** 2026-11-04
- **Requirements:** CONV-137, CONV-138, CONV-139, CONV-140

## Context

Each phase ends in a release (ADR-018). Tests and CI show that the code does what its
tasks say, but not that the phase delivers what was planned when it is used. Phase 1's
plan had an owner checklist for that, ticked by hand in Markdown. It recorded no
failures, and nothing tied it to the release.

The owner ran the same kind of pass on another project, RPGFieldbook, by typing an `x`
between brackets for each line, and wants something more interactive. Every phase
close already runs in a Claude Code session (`/docs close`), and the owner's GitHub
board already has a **Priority** field with `P0`, `P1`, and `P2`.

## Decision

- Each phase plan has sign-off checks, written from its deliverable when the plan is
  written: one per feature, each naming the deliverable item, what to try, and what to
  expect (CONV-138).
- At phase close, Claude walks the owner through the checks one at a time, asking each
  as a question with Pass, Fail, and Skip. Each check is answered on macOS and on
  Windows, and each answer is written into the plan's Sign-off table at once, so a pass
  can stop and resume (CONV-139).
- A failure becomes a GitHub issue labeled `bug` and `sign-off`, with the board's
  Priority set. `P0` blocks the release and is fixed by a task in the current phase.
  `P1` is high but does not block: it is listed as a known issue in the release notes
  and becomes a task at the start of the next phase. `P2` is deferred (CONV-140).
- The release waits until every check has passed on both systems, or has failed with
  only P1 or P2 bugs, and no P0 bug is open in the milestone (CONV-137, CONV-139).
- A bug issue is the bug's own record. Unlike a task's issue, it mirrors no file, and
  the Sign-off table links it. ADR-018 still governs task issues.

## Consequences

- The release asks whether the phase does what was planned, in the owner's hands, on
  both systems.
- Sign-off needs no new code. The table is plain Markdown, so it can still be filled in
  by hand without a session.
- `/docs close` enforces the gate, not the docs check, which stays offline and never
  reads GitHub (ADR-018).
- A release now waits on the owner's time on both machines.
- GitHub becomes the record for one thing: bugs. The status log lists open P0 and P1
  bugs as loose ends, so they stay in view.

## Alternatives considered

- **A development-only sign-off page in Mythos.** It would be the most interactive,
  but it is product code with its own task, spec text, and a switch to keep it out of
  production.
- **A GitHub QA issue with a checkbox per check.** Clicking replaces typing, but it
  records only pass or fail, and the record would start on GitHub, where ADR-018
  allows only mirrors.
- **A terminal walkthrough script, `pnpm qa`.** It would work without a session, but it
  is code to maintain for what a session already does.
- **The Markdown checklist, ticked by hand.** What RPGFieldbook does, and what the owner
  wants to move past.
