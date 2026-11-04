# Decision records

Each record explains one decision that is not obvious from the spec itself: the
context, what was decided, and what it costs. Requirements say *what*; records say
*why*.

| Record | Decision |
|---|---|
| [ADR-001](ADR-001-sse-for-server-events.md) | Server-Sent Events for server-to-client updates |
| [ADR-002](ADR-002-monorepo-shape.md) | A four-package pnpm monorepo with source-only shared packages |
| [ADR-003](ADR-003-hand-written-sql.md) | Hand-written SQL, no ORM |
| [ADR-004](ADR-004-event-sourcing-with-commit-sets.md) | Event sourcing with commit sets per stage |
| [ADR-005](ADR-005-copy-on-write-branches.md) | Branches as a turn tree with copy-on-write |
| [ADR-006](ADR-006-no-vector-index.md) | In-process similarity instead of a vector index |
| [ADR-007](ADR-007-adjudicate-resolve-narrate.md) | Separate adjudication, resolution, and narration |
| [ADR-008](ADR-008-rulesets-as-building-blocks.md) | Rulesets composed from fixed building blocks |
| [ADR-009](ADR-009-world-ticks-after-extraction.md) | World ticks run after extraction |
| [ADR-010](ADR-010-no-vendor-sdks.md) | Provider adapters use fetch, not vendor SDKs |
| [ADR-011](ADR-011-code-point-string-compare.md) | Code-point string comparison for ordering |
| [ADR-012](ADR-012-node-sqlite.md) | Built-in node:sqlite on Node 26, behind a thin wrapper |
| [ADR-013](ADR-013-themes-as-data.md) | Themes as validated data with bundled fonts |
| [ADR-014](ADR-014-hard-floor-in-code.md) | The content hard floor lives in code |
| [ADR-015](ADR-015-typescript-and-runtime.md) | TypeScript 6.0, run with tsx, no build step |
| [ADR-016](ADR-016-fixtures-and-reference-code.md) | Normative fixtures and non-normative reference code |
| [ADR-017](ADR-017-spec-is-the-documentation.md) | The spec is the documentation, kept true by each task |
| [ADR-018](ADR-018-github-mirrors-tasks.md) | GitHub issues mirror the tasks, and each phase is a release |

## When to write one

A record is for a decision that crosses documents or sets architecture (OVR-036):

- a new top-level package or app (ARCH-003), a new ruleset building block (RUL-001),
  or a runtime dependency outside the approved list (CONV-090, CONV-091);
- a change to how layers or modules depend on each other, how state is stored, or how
  the spec itself is kept;
- any decision that two or more documents would otherwise each have to argue.

Every other decision is a row in the Decisions table of the document that governs it
(OVR-035). A decision is superseded rather than edited: write a new record, and set
the old one's status to `Superseded by ADR-NNN`. Correcting a record's context without
changing its decision is an edit, noted in an **Amended** line under its date.

Claude drafts a record as `Proposed` when a change needs one and raises it under the
task's **Pending decisions**. It becomes `Accepted` when the owner says so.

## Template

```md
# ADR-NNN: Decision in a few words

- **Status:** Proposed | Accepted | Superseded by ADR-NNN
- **Date:** YYYY-MM-DD
- **Requirements:** IDs this decision affects

## Context

What forces the decision. Facts, constraints, and what was tried.

## Decision

What we do, stated plainly.

## Consequences

What gets easier, what gets harder, and what we accept.

## Alternatives considered

Each option and why it lost.
```
