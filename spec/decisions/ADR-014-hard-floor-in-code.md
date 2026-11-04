# ADR-014: The content hard floor lives in code

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** CSET-040 to CSET-046, CSET-062, MEM-057

## Context

Content intensity is the player's choice, up to explicit, and every prompt template is
overridable by packs and by the player. Local models may have no safety training of
their own. One rule must hold under every configuration: no sexual content involving
anyone under 18 or presented as a child.

## Decision

- The floor text is the `HARD_FLOOR` constant in `core`. Code appends it after
  template rendering to the prompt of every role that can produce or shape content
  (`FLOOR_ROLES`). No template, setting, or pack can remove or reword it.
- **Automatic tightening:** while any present or involved character is a minor,
  `sexual` is forced to `off` and explicit-content routing is disabled.
- Every character has an `ageCategory`, required at creation and fixed afterwards.
  Re-creating an existing entity ID to change it is rejected (CSET-044).
- Tests assert the floor is present in every role's prompt under every template
  override in the fixtures.

## Consequences

- No configuration can turn the floor off, by design.
- Pack authors cannot change its wording.
- A character whose age the fiction leaves unclear is created as a minor (CSET-045).
