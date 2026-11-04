# ADR-010: Provider adapters use fetch, not vendor SDKs

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** PRV-010, PRV-011, PRV-012, PRV-042

## Context

Phase 1 needs three text adapters: Ollama, OpenAI-compatible servers, and Anthropic.
Later phases add image and speech providers. Each vendor SDK has its own streaming
abstraction, error types, retry behavior, and release cadence.

## Decision

Adapters call HTTP APIs with the built-in `fetch`, parse streaming responses
themselves, and map every failure to the `ProviderError` codes in `contracts`.

## Consequences

- Few dependencies, and identical error handling across providers.
- Adapters are easy to test against the mock provider and recorded fixtures.
- API changes are tracked by hand. Adapters target the current API shape at
  implementation time (PRV-042), and their tests pin the wire format.

## Alternatives considered

- **Vendor SDKs.** Less code per adapter, but more dependencies, inconsistent errors,
  and retries hidden from the job queue.
