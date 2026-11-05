# Mythos

Mythos is a single-player, AI-run tabletop roleplaying game that runs locally in a
browser. A language model acts as the GM; TypeScript code owns rules, state, time, and
memory. Mike (the owner, in the spec) and Claude Code build it from a specification,
one task at a time: Claude writes the code and keeps the docs true, and Mike decides
and reviews. Mike maintains the code by hand afterwards, so clarity beats cleverness
everywhere.

## Before every task

1. Read `spec/00-overview.md` and `spec/glossary.md` once per session, and
   `.claude/status.md` for where things stand.
2. Read the task file in `spec/tasks/`, then only the spec sections it lists under
   **Read**, including the closing Traps, Decisions, and Open sections of those
   documents. Find a requirement fast with `grep -rn "RUL-014" spec/`.
3. Every task under **Depends on** must have Status `Done` on `main`; if one doesn't,
   stop. `pnpm trace` lists the tasks ready to start, but only for the checkout it runs
   in: run it in the main checkout, or after rebasing the branch onto `main`.
4. Start in plan mode (Shift+Tab, or prefix the prompt with `/plan`). Propose a plan
   that names each file you will create or change and any ruling you expect to make,
   and wait for Mike's approval before editing.

## Sources of truth

| Source | Status |
|---|---|
| `spec/*.md` | Normative, and the only description of each topic (ADR-017). Code blocks in them are copied verbatim. |
| `spec/fixtures/` | Normative data. Library and pack fixtures are copied byte for byte. |
| `spec/reference/` | Non-normative, tested reference code. You may port it; the spec wins any disagreement (OVR-031). Its README explains how to port. |
| `spec/decisions/` | Why things are the way they are, for decisions that cross documents. Read when a rule seems odd. |
| Task files | Status and completion notes: the log of what each task did and decided. |
| `pnpm trace` | What is built: task status, and the requirements done tasks list and tests cite. |
| `.claude/status.md` | Where things stand: focus, recent changes, pending decisions, loose ends. |
| GitHub issues, milestones, releases | A mirror for Mike's [Project Mythos board](https://github.com/users/wardmanm/projects/9): one issue per task, one milestone per phase, one release per phase (ADR-018). Never edited to show progress. A bug found at sign-off is an issue of its own, labeled `bug` and `sign-off`, with its Priority on the board (ADR-019). |

The code is the truth for what is built, and the spec for what must be. When they
disagree, one of them has a defect: find out which.

## Who decides what

- **Mike decides** anything that changes behavior or scope, any change to a decision
  already recorded in an ADR or a Decisions table, a runtime dependency outside the
  approved list (CONV-090), and when a branch merges (a batch he approves is then
  merged in order; see Workflow). Something is decided only when Mike says so.
- **Claude rules** on the calls a task needs: an extra file it must touch (CONV-132),
  or a spec fix with one reasonable answer (CONV-133). Every ruling is recorded with
  its reason, so Mike sees each one: in the task's completion notes, or, outside a
  task, in the message of its `spec:` commit, which `/status` lists.
- A question for Mike goes under the task's **Pending decisions**, with its options and
  whether it blocks the task. Your recommendation is one of the options, not the plan.

## Workflow

- One task per branch, named `pN-tNN-short-title` (CONV-130). Commit messages start
  with the task ID: `P1-T03: port calendar math` (CONV-131). Spec changes go in their
  own commits: `P1-T03: spec: …` in a task branch, `spec: …` outside one (CONV-133).
- Change the files the task lists under **Outputs**, plus its Status and Completion
  notes (CONV-132).
- Each task has a GitHub issue titled like its task file, labeled `task`, in its
  phase's milestone, and on the board (CONV-136). Open it when the task file is
  written. The task's PR has the same title, and its body starts `Closes #N`; the merge
  closes the issue and the board moves the card. Never move a card or edit an issue by
  hand.
- Each phase ends in a release, `v0.N.0`, published by `/docs close` (CONV-137) once
  Mike has signed off each feature: Claude asks the phase plan's checks one at a time,
  on macOS and on Windows. A failure is a bug with a Priority: P0 blocks the release,
  P1 is high but doesn't block, and P2 is deferred (CONV-138 to CONV-140).
- Done means (CONV-134): `pnpm check` passes; every requirement the task lists is
  implemented, and each behavioral one has a test whose name starts with its ID or an
  `ID: reason` entry under **Not tested**; no runtime dependency outside the approved
  list without an accepted ADR; module READMEs updated; traps and decisions recorded in the
  documents that govern them; completion notes written (CONV-135); no pending decision
  blocks the task; Status `Done`.
- Finish every task with `/docs land`. Before Mike merges, rebase onto `main` and run
  `pnpm check` again. After the merge, run `/status` on `main`.
- **Merging an approved batch.** When Mike approves a set of branches and their merge
  order, Claude merges them in that order without asking again. After each merge,
  rebase the next branch onto `main`, run `pnpm check`, update the summary line its
  completion notes quote, force-push, and merge only when CI passes on macOS and
  Windows.

## Keeping the docs current

The `docs` skill (`.claude/skills/docs/`) has the procedures, and ADR-017 explains
why. In short:

1. **Amend, don't annotate.** A requirement that turned out wrong is rewritten in place
   and keeps its ID. A new one takes the next number in its prefix, and a retired one
   is marked `(retired, <task or date>)` (OVR-034).
2. **Closing sections.** Traps, decisions later work must respect, and known
   limitations go at the end of the document that governs them, in **Traps**,
   **Decisions**, and **Open** (OVR-035). One-off calls stay in the completion notes.
   Decisions that cross documents get an ADR, `Proposed` until Mike accepts it
   (OVR-036).
3. **Never track progress by hand.** `pnpm trace` derives it (OVR-037).
4. **The docs check** in `pnpm check` keeps IDs, links, task files, and done tasks
   consistent (OVR-038).

## Session status log

`.claude/status.md` is where Mike catches up. The `status` skill writes it on `main`
only, never in a task branch, so it never conflicts in a merge. Keep it under about 60
lines, in four sections:

- **Current focus:** where the phase stands, the next tasks whose dependencies are
  done, and any open branch.
- **Recent changes:** one dated line per merged task or spec change, keeping about the
  last ten.
- **Pending decisions:** every open question, carried over until Mike decides it.
- **Loose ends:** unfinished work, such as untested requirements worth revisiting,
  skipped tests, unpushed commits, or unmerged branches.

Every line is checked against the repository, not recalled from the conversation. No
secrets or credentials.

## Context handoffs

When work reaches a natural stopping point and the next task would go better in a fresh
context, tell Mike it's a good time to clear context, and give him a handoff to paste
into the new session. Don't wait to be asked.

- **Good points:** a feature or fix is merged, a design or plan is approved and
  committed, a release is done, or the session is long and the next task needs little
  of it. Never mid-task, or while waiting on an answer from Mike.
- **Before handing off,** commit or record everything worth keeping: run `/status` on
  `main`, and on a task branch commit its completion notes and Pending decisions. The
  new session can't see this one.
- **The handoff** is one fenced block, written for a session that knows nothing about
  this one:
  - **Goal:** the next task, and where it comes from (issue, spec, plan).
  - **State:** the branch, what's merged or pushed, and anything uncommitted or still
    running.
  - **Decisions:** choices already made that must be kept, and who made them.
  - **Read first:** the files, docs and issues to open, in order. Link facts that
    already live in the repo instead of copying them.
  - **Watch out for:** gotchas found along the way.
  - **First step:** the first concrete action.

## Commands

These exist once tasks P1-T01 and P1-T02 are complete.

| Command | Does |
|---|---|
| `pnpm install` | Installs the workspace |
| `pnpm check` | Typecheck, lint, all tests, fixture-copy check, spec drift check, docs check. The only definition of passing. |
| `pnpm test` | All tests; `pnpm --filter @mythos/core test` for one package |
| `pnpm trace` | Task status and requirement counts per document |
| `pnpm dev` | Server (`tsx watch`) and client (Vite) together |

Run `pnpm check` before saying a task is done, and quote its final summary line under
**Done** in the completion notes.

## Rules you will need on every task

From `spec/02-conventions.md`, which has the full list:

- TypeScript strict, no `any`, no `!` outside tests, no `enum`, no default exports,
  no classes except stateful adapters. Types come from Zod schemas (`z.infer`).
- Parse every boundary input with Zod: HTTP bodies, files, SQLite rows, SSE payloads,
  model output. Model output is untrusted (CONV-032).
- Expected failures return `Result`; unexpected ones throw (CONV-040, CONV-041).
- `packages/core` is pure: no IO, no `Date.now()`, no `Math.random()`. Time and
  randomness are parameters.
- Sort with `cmp` from `core`, never `localeCompare` (CONV-087).
- Build paths with `node:path`. No shell scripts; anything nontrivial is a Node script
  in `/scripts`. Code must behave identically on Windows and macOS.
- SQL is hand-written; only the storage wrapper imports `node:sqlite` (CONV-055).
- Cite requirements in code (`// Implements RUL-014.`) and start test names with them
  (`it('RUL-014: two sixes are a critical', …)`).
- No `console.log` outside `/scripts` and `apps/server/src/cli/`; use the injected logger
  with structured fields.
- Files under 300 lines, functions under 50, where practical (CONV-014).
- New runtime dependency: only from the approved list (CONV-091). Anything else is a
  pending decision with a Proposed ADR (CONV-090).
- Tests never touch the network or a real model; use the mock provider (CONV-113).

## Never

- Weaken, move, or reword the content hard floor. It lives in `core` and is appended
  by code to every prompt (13-content-settings §5, ADR-014).
- Let the client call a model or hold a game rule (ARCH-011, ARCH-012).
- Write directly to projection tables; game state and its history change only through commits (ARCH-040).
- Edit an applied migration (CONV-052).
- Change behavior, scope, or a recorded decision in `spec/` without Mike's say-so
  (CONV-133).
- Renumber or reuse a requirement ID (OVR-034).

## Notes for Claude Code

- Keep context lean. Read the spec sections a task lists rather than whole documents,
  and grep for requirement IDs instead of scrolling.
- When porting from `spec/reference/`, read its README first. Ported code is
  reformatted, documented, and its tests renamed by requirement ID; it is never pasted
  as is.
- Parallel tasks run in separate worktrees, one task per worktree.

## Repository map

```
apps/server         Fastify server: modules under src/modules/<name>/ (ARCH §3)
apps/client         React + Vite client (ARCH §7)
packages/contracts  Zod schemas, copied from the spec
packages/core       Pure game logic
content-library     Built-in library, copied from spec/fixtures/library
content-packs       The reference pack, copied from spec/fixtures/packs/reference
scripts             Cross-platform Node scripts
spec                The specification, fixtures, reference code, phases, and tasks
.claude             The status log and the status and docs skills
```
