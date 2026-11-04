# P1-T12: Anthropic adapter

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T10 |
| **Branch** | `p1-t12-anthropic-adapter` |

## Goal

Talk to the Anthropic Messages API, with prompt-cache breakpoints, streaming,
structured output, and the schema adaptation Anthropic needs.

## Read

- `spec/05-providers.md` §3 (PRV-010 to PRV-013, PRV-040 to PRV-043), §4, §5 (PRV-052)
- `spec/09-context.md` CTX-010, CTX-011
- Anthropic's current Messages API documentation, including streaming events, prompt caching, tool use, and structured outputs (PRV-042)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

PRV-010, PRV-011, PRV-012, PRV-013, PRV-040, PRV-041, PRV-042, PRV-043, PRV-045, PRV-046, PRV-047, CTX-011

## Outputs

- `apps/server/src/modules/providers/adapters/anthropic.ts` and its test
- Registry case
- Providers `README.md` section

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other providers files except the registry

## Design notes

- System messages become the `system` parameter as content blocks; a message with
  `cacheBreakpoint` gets `cache_control: { type: "ephemeral" }` on its block (PRV-041).
  Consecutive same-role messages are merged into one message with one block each,
  keeping their breakpoints (PRV-043, CTX-011).
- Check the documentation for the current structured-output mechanism (PRV-040) and
  record what you used, with the documentation date, in the README and completion notes.
- The adapter receives JSON Schemas already adapted by the pipeline (PRV-050 step 2,
  PRV-052, built in P1-T14); it does not adapt them itself.
- Thinking blocks go to `TextResponse.thinking`, never to `onDelta` (PRV-046).
- Abort as PRV-047, like the other adapters.
- Report `cache_read_input_tokens` as `cachedInputTokens`.
- Test against a fake server built with `node:http`.

## Acceptance

- [ ] A three-tier prompt produces system blocks and user content blocks with cache breakpoints exactly where CTX-010 puts them.
- [ ] Streamed text and thinking are separated; usage includes cached tokens.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
