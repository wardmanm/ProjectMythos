---
name: status
description: Use when Mike types /status, after a task branch merges into main, before pushing main, or before ending a session — whenever `.claude/status.md` (the status log in CLAUDE.md) may be out of date.
argument-hint: (no arguments)
---

# Status log

`.claude/status.md` is where Mike catches up on Mythos. Someone acts on every line in
it, so each line is checked against the repository, never recalled from the
conversation.

## Where it is written

- **On `main` only.** Task branches never touch it, so it never conflicts in a merge.
- If `git branch --show-current` does not print `main`, stop and say: "the status log
  is written on main; run /status there after the merge". `main` can be checked out
  in only one worktree, so this check covers worktrees too.

## Gather, then write

The old file's header names the commit it was written through (`Through: <sha>`).
Everything since then is new. Run these and read the output:

```bash
cat .claude/status.md                                         # the old file and its Through sha
git log --first-parent --date=short --format='%ad %h %s' <sha>..main   # what landed since
git diff --name-only <sha>..main -- spec/tasks/               # task files changed since
git log --date=short --format='%ad %h %s%n%b' <sha>..main -- spec/   # spec commits, with reasons
git worktree list; git branch --no-merged main                # work still open
git status --short                                            # uncommitted work
git rev-parse -q --verify origin/main >/dev/null && git log --oneline origin/main..main   # unpushed
pnpm trace                                                    # task status, tasks ready to start
gh issue list --label task --state open --limit 200 --json number,title   # task issues still open
```

Then read:

- **Each task file that changed since `<sha>` and is now `Done`.** Take its completion
  notes' **Pending decisions** and **Not tested** entries.
- **Each unmerged task branch's own task file**, e.g.
  `git show p1-t09-events-module:spec/tasks/P1-T09-events-module.md`. Take its
  **Pending decisions**, marked "(branch open)". A blocking one belongs under Current
  focus.

Use only what these show, plus decisions Mike stated in this session. If there is no
old file or no `Through` sha, read the whole history.

## The file

```
# Status: Mythos
Updated: YYYY-MM-DD · Through: <short sha of main> · Branch: main

## Current focus
## Recent changes
## Pending decisions
## Loose ends
```

Keep it under about 60 lines.

- **Current focus:** the phase, the tasks `pnpm trace` lists as ready to start, any
  open branch and what blocks it, or "no branch open".
- **Recent changes:** one line per merged task or `spec:` commit, dated and naming the
  task ID. A merged task's line names its rulings in brief, and any decisions of
  Mike's it carried out. A `spec:` commit made outside a task is a ruling too, so give
  its reason from the commit message. A `spec: owner:` commit carries out Mike's
  decision and is listed as his. Keep the last ten or so.
- **Pending decisions:** carry over every open one from the old file, and add those
  raised since, in completion notes, open branches, or this session. A question
  already listed "(branch open)" is not added again when its branch merges. Drop any
  question whose notes mark it `Decided`, and record the outcome under Recent changes.
  Write each one
  as: `**Title** (raised YYYY-MM-DD, P1-Tnn): the question. Options: a / b. Claude's
  suggestion: … Blocks: …`. A question is decided only when Mike says so. When he
  does, remove it here, record the outcome under Recent changes, and make the change
  (`/docs amend`).
- **Loose ends:** unfinished work, checked against the code. That includes **Not
  tested** entries worth revisiting, failing or skipped tests, uncommitted or unpushed
  work, unmerged branches, and GitHub drift (CONV-136): a `Done` task whose issue is
  still open, or a task with no issue. Carry over the old file's items that are still true. A
  limitation recorded in a document's **Open** section is not a loose end; leave it
  there.
- No secrets or credentials. API keys live in machine config, never in the repository.

## Commit

Set `Through:` to `main`'s commit before this one (`git rev-parse --short HEAD`), then:

```bash
git add .claude/status.md && git commit -m "status: YYYY-MM-DD"
```

Push only when Mike has said `main` may be pushed. Otherwise commit, don't push, and
say so.

## Common mistakes

| Mistake | Instead |
|---|---|
| Paraphrasing the session ("the adapter needs a fix") | Read the code or the completion notes and say what they actually show |
| Calling a task done because work started | Done means Status `Done` on `main`, after the merge |
| Dropping the old file's open decisions | Carry them over until Mike decides them |
| Re-adding a decision Mike already made | Only read what changed after the `Through` sha |
| Your suggestion written as the plan | It is one of the options under Pending decisions |
| Copying progress counts by hand | Quote `pnpm trace` |
