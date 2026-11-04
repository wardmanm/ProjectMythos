# ADR-011: Code-point string comparison for ordering

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** CONV-087

## Context

Building world-tick batches surfaced a bug: `localeCompare` and `Intl.Collator`
order strings according to the machine's ICU locale data. Windows and macOS, or two
machines with different locales, can disagree, so prompts, stored orderings, and test
expectations could differ by machine.

## Decision

Ordering that reaches stored data, prompts, or tests uses the `cmp` helper in `core`,
which compares by code point. Locale-aware sorting is allowed only for display-only
lists in the client.

## Consequences

- The same campaign produces the same prompts on every machine, which keeps prompt
  caching and snapshot tests stable.
- Code-point order puts uppercase before lowercase and is not friendly for display.
  Display lists sort separately.
