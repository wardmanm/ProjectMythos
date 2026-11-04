# ADR-018: GitHub issues mirror the tasks, and each phase is a release

- **Status:** Accepted
- **Date:** 2026-11-04
- **Requirements:** OVR-037, CONV-136, CONV-137

## Context

The owner follows the project on a GitHub Projects board, "Project Mythos"
(https://github.com/users/wardmanm/projects/9), and wants each task, phase, and
release visible there. ADR-017 keeps a task's state only in its task file and derives
progress with `pnpm trace` (OVR-037), because hand-kept copies rot.

The board's built-in workflows are on. They add this repository's new issues to the
board, move a card when a pull request is linked to its issue, and move it to Done when
the pull request merges or the issue closes. A card can therefore follow the work
without anyone moving it.

## Decision

- Each task has one GitHub issue, opened when the task file is written. It is titled
  like the task file, labeled `task`, in its phase's milestone, and on the board. Its
  body links the task file and the issues it depends on (CONV-136).
- Each phase has a milestone, `Phase N: <name>`, described by its deliverable in
  00-overview §7. All ten exist from the start.
- A task's pull request starts its body with `Closes #N`. The merge closes the issue,
  and the workflows move the card. Nobody moves cards or edits issues to show progress.
  The task file's Status row stays the only record (OVR-037).
- Each phase ends in a release. At phase close, the root `package.json` version
  becomes `0.N.0`, `main` is tagged `v0.N.0`, and a GitHub release is published with
  the phase plan's Retrospective as its notes (CONV-137). Version 1.0 is a later
  decision.

## Consequences

- The owner sees tasks, phases, and releases on GitHub without opening the repository.
- An issue is a mirror, so it can drift in only two ways: it stays open after its
  task merged, or a task has no issue. The status log lists either as a loose end.
- Opening issues and publishing releases needs the `gh` CLI with the `repo` and
  `project` scopes. The docs check stays offline and never reads GitHub.

## Alternatives considered

- **The board as the source of truth.** It would retire the Status rows and the task
  list in `pnpm trace`, which the docs check relies on (OVR-038).
- **The board for work outside the spec only.** Simpler, but the owner wants the tasks
  themselves on the board.
- **A release per merged task.** A patch tag after every merge adds noise. A phase is
  the first point at which Mythos is playable and testable (00-overview §7).
