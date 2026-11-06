# P1-T13: Job queue

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
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

- [x] ARCH-081: two devices run in parallel; one device with concurrency 1 runs its jobs one at a time, highest priority first.
- [x] PRV-063: retryable failures back off exponentially up to `maxAttempts`; a non-retryable failure stops at once.
- [x] PRV-064: an interactive job preempts a running background job on the same device, which then resumes.
- [x] ARCH-082: a persisted job survives a simulated restart and runs once.
- [x] ARCH-083: cancelling an interactive job aborts its signal.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/providers/`: `queue.ts` (the §6 code block, byte for byte,
    above a divider line, then `createJobQueue`), `queue-runner.ts`, `queue-policy.ts`,
    `queue-persistence.ts`, `queue-testing.ts` (test helpers, not exported), `index.ts`
    (the queue's exports, in a block of their own), and `README.md` (a "Job queue"
    section, the Files list, the introduction, and the governing spec), with 28 tests in
    three files: `queue.test.ts`, `queue-runner.test.ts`, and
    `queue-persistence.test.ts`. Storage is unchanged: `insertJob`, `updateJob`, and
    `listUnfinishedJobs` were enough.
  - The queue imports `config` (the `ConfigStore` type), `storage` (the campaign store
    and the jobs repository), and `events` (the `publish` type), as ARCH-021 allows. Its
    `TimeSource`, backoff timer (`setTimer`), and logger are injected; job IDs come from
    `randomUUID` (CONV-053).
  - Acceptance, by test:
    - ARCH-081: `two devices run in parallel, and a device with concurrency 1 runs one
      job at a time, highest priority first`;
    - PRV-063: `retryable failures back off 2 s, 8 s, then 30 s at most, until
      maxAttempts; then the job fails and onFailed runs`, and `a non-retryable failure
      (%s) fails the job at once`, an `it.each` over a `provider_rejected` error and an
      error without `retryable: true`;
    - PRV-064: `an interactive job preempts a running background job on its device,
      which then resumes`;
    - ARCH-082: `a persisted job survives a simulated restart and runs once` (the first
      queue is abandoned mid-run, as in a crash), and `stop() stores a running
      background job as queued without counting an attempt, and cancels interactive
      work`;
    - ARCH-083: `cancelling a running interactive job aborts its signal, and the caller
      gets what the work returned`.
  - Also tested, as planned: resume in stored order across two campaigns; a stored job
    with no handler, or with a bad payload, marked `failed` while the rest resume; a
    campaign with a corrupt database logged and skipped; the take-back before a
    campaign's first new job, once; a thrown error failing as `internal_error`;
    `retryAfterSeconds` lengthening the wait; `preemptBackground: false`; the later of
    two running jobs preempted; `register` and `enqueue` throwing; every status change
    stored, then published, seen through a real `createEventBus` subscription; nothing
    published for a null `campaignId`; device and priority on every record (ARCH-131);
    concurrency read again at the next decision (PRV-004), and concurrency 1 for a
    device missing from config and while config fails to load.
  - Verified, then reverted: preempting the first-started job instead of the last
    fails the two-slot PRV-064 test; a backoff factor of 2 fails both backoff tests;
    counting an attempt on preemption fails the PRV-064 resume test; leaving a stored
    `running` job's status alone on resume fails the ARCH-082 restart test and the
    stored-order test; skipping the take-back in `enqueue` fails its PRV-062 test.
  - `pnpm check` passes, run after `git fetch` and a rebase onto `origin/main`. The
    workspace has `Tests  591 passed (591)` and `spec/reference` `Tests  271 passed
    (271)`, and it ends with `Docs check passed: 834 requirements, 25 tasks (13 done),
    20 ADRs, 82 markdown files, 805 citations in code.`
- **Rulings:**
  - **Owner's decisions** (Mike, on the plan, 2026-11-05), in `P1-T13: spec: owner:
    resume at start, interactive retries, onFailed, unknown devices`, each with a
    05-providers Decisions row:
    - PRV-062's last two sentences are reworded: at server start the queue re-enqueues
      every campaign's unfinished persisted jobs (`queued` and `running`) in stored
      order, logging and skipping a campaign that fails to open or migrate; before a
      campaign's first new job it also takes back that campaign's stored jobs, once per
      campaign per process. This replaces "re-enqueue on open", and matches TRN-012.
    - `runInteractive` retries transient errors with the background policy, so PRV-051
      holds in phase 1. A 05-providers Open entry asks P1-T14 to return an error that
      arrives after text has streamed with `retryable: false`.
    - `JobHandler` has an optional `onFailed(payload, error): Promise<void>`, identical
      in the §6 code block and in `spec/reference/server-types/providers/queue.ts`, and
      PRV-063 names it. The queue calls it once, after storing and publishing `failed`.
    - A job on a device missing from machine config runs at concurrency 1.
  - **Spec fixes** (`P1-T13: spec: PRV-061 and PRV-063 wording, and the queue's
    rulings`):
    - **PRV-063** (CONV-133): the backoff's "…" is filled in: 2 s, four times longer
      after each failure, at most 30 s, or `details.retryAfterSeconds` when longer.
    - **PRV-061**: the caller cancels by aborting the signal it passed to
      `callStructured` or `streamText`, which cancels the job. "The signal it passed
      in" named no signal the queue receives.
  - **05-providers Decisions, Claude (ruling)**, in the same commit: `register` takes
    only persisted background handlers (PRV-066); interactive jobs have type
    `interactive` (PRV-065, PRV-067); only an error with `retryable: true` is retried
    (PRV-051, PRV-063); the backoff (PRV-063); what `attempts` counts, and that a
    preempted or stopped run that returns `ok` succeeds (PRV-063, PRV-064); cancelled
    jobs (ARCH-083); `wait` on a job the queue does not hold returns `not_found`; a
    preempted job's slot frees only when its run settles (PRV-064); a caller cancels
    through `cancel(jobId)` (PRV-061).
  - **05-providers Traps**: a handler that ignores its signal holds its device; register
    every handler before `resume()`. **Open**: `resume()` opens every campaign's
    database, and the store keeps the connections open.
  - **Extra files** (CONV-132, CONV-014, ARCH-020): `queue-policy.ts`,
    `queue-persistence.ts`, `queue-testing.ts`, and `queue-persistence.test.ts`, as
    planned, and `index.ts`'s exports. Beyond the plan: `queue-runner.ts` and
    `queue-runner.test.ts`. With the runs, retries, cancel, and stop in it, `queue.ts`
    came to 481 lines, so they moved to the runner, and the preemption and retry tests
    with them; every file is now under 300 lines.
  - **Smaller calls**:
    - `JobQueueLifecycle` (`resume`, `stop`), `JobQueueOptions`, `SetTimer`, and
      `QueueLogger` follow the verbatim block in `queue.ts`, and the implementation's
      imports follow its divider line, so the block is untouched.
    - After `stop()`, `wait` on a background job resolves with `cancelled` ("resumes at
      the next start") rather than staying pending, and `enqueue`, `runInteractive`,
      and `resume` throw.
    - A stored job that cannot be bound fails with `internal_error`, without
      `onFailed`, since there is no parsed payload to give it.
    - `enqueue` for a campaign that does not exist returns its `not_found`; a payload
      that is not JSON throws, as one that fails its schema does (PRV-066).
    - A change that cannot be stored (its campaign was deleted, or its database broke)
      is logged, and the queue goes on in memory.
    - Resume publishes `job.updated` for a stored `running` job it puts back to
      `queued`, and nothing for a stored `queued` job, whose status does not change.
    - `onFailed` runs in a later microtask, and a throw or rejection in it is logged.
    - The Acceptance checklist is ticked.
- **Pending decisions:** None.
- **Not tested:** None. Every listed requirement has a test named by its ID. PRV-061's
  link from the caller's signal to `cancel(jobId)` belongs to P1-T14, which also lists
  PRV-061; the queue's half, `cancel` aborting the work's signal, is tested under
  ARCH-083.
- **Dependencies:** None new. The queue uses `zod`, `node:crypto`, and the workspace
  packages already in `apps/server`.
