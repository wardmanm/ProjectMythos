# ADR-017: The spec is the documentation, kept true by each task

- **Status:** Accepted
- **Date:** 2026-11-02
- **Requirements:** OVR-020, OVR-021, OVR-031, OVR-034 to OVR-038, CONV-122,
  CONV-132 to CONV-135

## Context

Mythos is built by the owner, who decides and reviews, and Claude Code, which writes
the code. The spec was written before any code. It has about 820 requirement
IDs, normative fixtures, and reference code that a drift check ties to the text
(ADR-016). Three needs follow from that:

- the owner needs to see what happened and what is waiting on his decision, without
  reading code or logs;
- Claude needs the current truth for an area, cheap to load and checkable by machine;
- neither of them should have to keep two descriptions of the same system in step.

RPGFieldbook, the owner's other project, documents itself another way. It had no
spec, so a log of changes (its wiring ledger) became the only record of how things
worked. That log reached 3,707 lines and was a poor reference, so a living wiki was
compiled from it: topic pages that say how the app works now. It works, but its
upkeep shows what two descriptions cost. Every change writes a ledger entry, rewrites
its pages, adds History lines, updates a decisions register, and adds a release note,
and every merge re-points ledger line numbers. Since the wiki arrived, the ledger has
grown to 8,228 lines. Fieldbook's status log, and its rule that something is decided
only when the owner says so, have worked well.

## Decision

- **One description.** Each spec document is the only place its topic is described.
  When the build shows a requirement is wrong, the requirement is amended in the same
  branch as the code (OVR-020, OVR-034). There is no separate wiki.
- **Closing sections.** As code lands, a document gains **Traps**, **Decisions**, and
  **Open** sections at its end (OVR-035). Small decisions are rows in that table, with
  who decided them. ADRs are kept for decisions that cross documents or set
  architecture (OVR-036).
- **Rulings and pending decisions.** Claude makes the calls a task needs and records
  each one as a ruling. That includes extra files changed and spec fixes with one
  reasonable answer. Anything that changes behavior, scope, or a recorded decision is
  a pending decision that waits for the owner (CONV-132, CONV-133).
- **The task file is the log.** Its Status row and five-part completion notes
  (CONV-135), commits that start with the task ID, and spec changes in their own
  `spec:` commits replace a ledger.
- **What is built is derived.** `pnpm trace` reports task status and, per document,
  which requirements done tasks list and tests cite (OVR-037). A docs check in
  `pnpm check` keeps IDs, links, ADR citations, task files, and done tasks consistent
  (OVR-038).
- **A status log.** `.claude/status.md` holds the current focus, recent changes,
  pending decisions, and loose ends. It is written on `main` by the `/status` skill
  and checked against the repository, not recalled from a conversation. The `/docs`
  skill holds the land, amend, close, query, and lint procedures.

## Consequences

- A topic has one home, and the owner reviews spec changes as diffs.
- Where things stand comes from git and the task files, so it cannot drift from them.
- Problems in the spec surface as rulings and pending decisions instead of silent
  workarounds, and the owner sees each one.
- Documents mix "must" with traps and decisions learned while building. Only
  `pnpm trace`, not the prose, says what is built.
- Writing completion notes and closing sections is part of every task's cost.
- ADR-016's context no longer mentions a second coding agent; its decision is
  unchanged.

## Alternatives considered

- **Fieldbook's living wiki beside the spec.** Two descriptions of one system drift,
  and Fieldbook's own design names that as its main risk. Fieldbook needed the wiki
  because it had no spec.
- **An append-only ledger.** Git history and the completion notes already hold it,
  and citing ledger line numbers breaks on every merge.
- **A decisions register.** The Decisions tables and the ADR index cover it, and grep
  finds a row.
- **Writing the status of each requirement by hand.** It rots. Test names and task
  status give it for free.
- **Stopping on every spec problem (the earlier CONV-133).** That suited a smaller
  model working on its own. With the owner reviewing every branch, it is cheaper to fix
  unambiguous problems as recorded rulings, and the owner still sees every one.
