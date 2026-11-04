# P1-T15: Probe and provider health

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T11, P1-T14 |
| **Branch** | `p1-t15-probe-and-health` |

## Goal

Let the settings screen test a model profile and show each provider's status.

## Read

- `spec/05-providers.md` §6 (PRV-067), §9 (PRV-090 to PRV-092), PRV-031
- `spec/03-contracts.md` §14.1 (`ProbeResult`, `ProviderStatus`)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

PRV-031, PRV-090, PRV-091, PRV-092

## Outputs

- `apps/server/src/modules/providers/probe.ts`, `health.ts`, tests
- Exports from the providers `index.ts`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Adapter files

## Design notes

- The probe calls the profile's adapter directly through `runInteractive` with
  `campaignId: null`, adapts schemas with P1-T14's `schema-adapt`, sends
  `role: 'narrator'`, and records nothing (PRV-092). It sends a short text
  prompt (measuring prompt and generation speed from usage and timing), then the same
  tiny structured request with each method the provider supports, and reports which
  produced valid output. `suggestions` recommend the fastest valid method, a context
  window warning below 8,192 tokens (CTX-032), and turning thinking off if it was
  emitted while the profile says `off`.
- Health calls each adapter's `health` with a five-second timeout, in parallel.

## Acceptance

- [ ] With the mock adapter scripted to fail `json-schema` and pass `tool-call`, the probe reports exactly that and suggests `tool-call`.
- [ ] A provider that times out reports `reachable: false` with a plain-words `detail`.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
