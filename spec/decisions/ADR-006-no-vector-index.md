# ADR-006: In-process similarity instead of a vector index

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** MEM-081, MEM-083, MEM-084, MEM-136

## Context

Memory retrieval ranks a character's known observations by relevance, recency, and
importance. Retrieval must respect knowledge boundaries exactly: one knower, one
branch, one read point.

## Decision

Embeddings are stored in the campaign database once per text and model. Retrieval
first narrows candidates with SQL (this knower's knowledge, this branch, this read
point), then computes cosine similarity in process. `retrieve` hides the method.

## Consequences

- Knowledge scoping is exact. A vector index would return nearest neighbors across
  everyone's memories, to be filtered afterwards.
- No native dependency (CONV-084).
- Tens of thousands of observations take milliseconds. MEM-136 tests the bound with a
  generated 20,000-observation campaign.

## Alternatives considered

- **sqlite-vec or an HNSW library.** Faster at millions of vectors, which a
  single-player campaign will not reach, at the cost of a native dependency and
  approximate, post-filtered results.

## Revisit when

MEM-136's performance bound fails on real hardware. Add an index behind `retrieve`.
