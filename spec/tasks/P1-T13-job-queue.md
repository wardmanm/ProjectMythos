# P1-T13: Job queue

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
| **Depends on** | P1-T07, P1-T09, P1-T10 |
| **Branch** | `p1-t13-job-queue` |

## Goal

Run every model call as a job: per-device concurrency, priorities, preemption,
cancellation, retries with backoff, persistence for background jobs, and progress
events.

## Read

- `spec/01-architecture.md` §6.1 (ARCH-080 to ARCH-083)
- `spec/05-providers.md` §6 (the code block and PRV-060 to PRV-066)
- `spec/03-contracts.md` §11 (`JobSchema`)
- `spec/06-turn-engine.md` TRN-012

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-080, ARCH-081, ARCH-082, ARCH-083, ARCH-131, PRV-051, PRV-060, PRV-061, PRV-062, PRV-063, PRV-064, PRV-065, PRV-066, PRV-067

## Outputs

- `apps/server/src/modules/providers/queue.ts` (the 05-providers §6 types verbatim, then the implementation) and `queue.test.ts`
- Providers `README.md` section
- Additions to the storage jobs repository, if needed (see P1-T07's public API note)

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Storage files other than the jobs repository

## Design notes

- Inject a `TimeSource` and a scheduler (for backoff timers) so tests run instantly and
  deterministically (CONV-061).
- Devices come from machine config and are re-read on every scheduling decision, so
  config edits apply without restart (PRV-004).
- Background jobs (priority `extraction` and below) are persisted through the storage
  module's jobs repository and resumed at startup; interactive jobs are not (PRV-061,
  TRN-012). Phase 1 has no background job types yet, but persistence and resume must
  work and be tested with a test-only handler.
- Preemption (PRV-064) aborts a running background job's signal and re-queues it
  without counting an attempt.
- **Interactive jobs** run through `runInteractive` (PRV-067): the caller's function runs
  in a device slot at interactive priority and its result is returned; nothing is
  persisted, so it may hold callbacks. `campaignId` may be null (the probe, PRV-092).
- Publish `job.updated` through an injected `publish` function from the events module
  (ARCH-022), for jobs that belong to a campaign.

## Acceptance

- [ ] ARCH-081: two devices run in parallel; one device with concurrency 1 runs its jobs one at a time, highest priority first.
- [ ] PRV-063: retryable failures back off exponentially up to `maxAttempts`; a non-retryable failure stops at once.
- [ ] PRV-064: an interactive job preempts a running background job on the same device, which then resumes.
- [ ] ARCH-082: a persisted job survives a simulated restart and runs once.
- [ ] ARCH-083: cancelling an interactive job aborts its signal.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
