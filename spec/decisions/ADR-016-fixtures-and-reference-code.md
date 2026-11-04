# ADR-016: Normative fixtures and non-normative reference code

- **Status:** Accepted
- **Date:** 2026-10-13
- **Amended:** 2026-11-02, context only: one coding agent, not two (ADR-017)
- **Requirements:** OVR-030 to OVR-033

## Context

Claude Code writes the code from this spec, and the owner reviews every task. Code
written without a concrete world, ruleset, or theme to aim at invents one, and
inconsistently; code blocks copied by hand drift from the documents. Before the spec
was written, every pure subsystem was implemented and tested to validate it.

## Decision

- **Fixtures** in `spec/fixtures/` are complete, normative data: the built-in library,
  the Brinemoor reference pack, and test-only data. Library and pack fixtures are
  copied into the repository byte for byte, and `pnpm check` fails on any difference.
- **Reference code** in `spec/reference/` ships with the spec: the contracts, the pure
  `core` logic, server interface types, a fixture checker, a drift checker, and about
  250 tests. It is non-normative; the documents win any disagreement. Tasks may port
  it, meeting the conventions.
- The **drift check** proves every code block in the documents equals the reference
  code or a fixture, and runs in `pnpm check`.

## Consequences

- Tasks start from validated code and a real world to play in.
- The documents cannot silently diverge from code that compiles.
- The contracts exist twice, in `spec/reference/contracts/` and
  `packages/contracts/src/`. The repository's spec check compares them.
- Reference code is dense validation code. Porting it means reformatting, documenting,
  and renaming tests by requirement ID, which tasks must budget for.
