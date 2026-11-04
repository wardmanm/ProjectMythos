# P1-T14: Structured-output pipeline, streaming, call records

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T13 |
| **Branch** | `p1-t14-structured-pipeline` |

## Goal

Implement `callStructured` and `streamText` on top of the queue: schema
conversion and adaptation, format instructions, extraction and repair of JSON,
validation with retries, the prompt-only fallback, and a model call record for every
call.

## Read

- `spec/05-providers.md` §2.2 (PRV-001), §3.1 (PRV-040), §4, §5 (the code block and PRV-050 to PRV-054), §6 (PRV-067), §7
- `spec/03-contracts.md` §1 (CON-003 to CON-005), §14.1
- `spec/09-context.md` §9 (CTX-090)
- `spec/01-architecture.md` §4.4 (ARCH-060, ARCH-061)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-060, ARCH-061, PRV-001, PRV-040, PRV-045, PRV-046, PRV-047, PRV-050, PRV-051, PRV-052, PRV-053, PRV-054, PRV-061, PRV-067, PRV-071, CON-004, CONV-032

## Outputs

- `apps/server/src/modules/providers/structured.ts` (the 05-providers §5 types verbatim, then the implementation), `schema-adapt.ts`, `role-routing.ts`, `records.ts`, tests
- Providers `README.md` section

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Adapter files

## Design notes

- **Role routing.** The role's assignment comes from machine config's `roles`. An
  unassigned role fails with `not_configured` naming the role (PRV-001); `npc-voice`
  falls back to the narrator's assignment. Explicit-content routing (PRV-006) arrives
  in phase 3. Export the routing function so the composition root can also give it to
  the context module (CTX-110).
- **Schema adaptation** (PRV-052) is a pure function per provider: for Anthropic, set
  `additionalProperties: false` on every object and remove the keywords PRV-040 lists;
  the others pass the schema through.
- A call with `job: null` (every call in phase 1) runs through the queue's
  `runInteractive` on the profile's device; a call given a `JobContext` runs in that
  job's slot under its signal (PRV-067). Test both.
- **Records.** Every call writes one `ModelCallRecord` through storage, with every
  attempt, the messages, and the caller's `PromptReport` (PRV-054). Calls without a
  campaign (the probe) are not recorded.
- After each call, feed the reported input tokens to calibration (PRV-071).
- `streamText` forwards deltas to the caller's `onDelta` and returns `StreamedText`:
  the text and its `finishReason`. On cancel it returns what arrived with
  `finishReason: 'cancelled'` and marks the record `cancelled` (PRV-047).
- Use `jsonrepair` for step 5 of PRV-050 (approved in CONV-091).

## Acceptance

- [ ] PRV-050: with the mock adapter, a first answer with a code fence and trailing prose parses; a second with a schema error retries with the issues listed; a third failure returns `model_output_invalid` with all three attempts in `details`.
- [ ] PRV-053: `provider_rejected` on `json-schema` retries once as `prompt-only` and the record shows the switch.
- [ ] PRV-054: failed attempts are recorded; the record parses with `ModelCallRecordSchema` when read back.
- [ ] PRV-052: the Anthropic-adapted schema has `additionalProperties: false` on every object and none of the unsupported keywords.
- [ ] PRV-001: a call for an unassigned role fails with `not_configured` naming the role.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
