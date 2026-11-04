---
name: docs
description: Use when finishing any Mythos task (/docs land), when Mike decides a pending question or a spec change is needed (/docs amend), when a phase ends (/docs close), when asked how some part of Mythos works (/docs <question>), or when asked to check the spec for drift (/docs lint).
argument-hint: land | amend | close | lint | <question>
---

# Mythos docs

The spec is the documentation (ADR-017). Each document in `spec/` is the only
description of its topic: what it must do, and, once its code lands, the traps and
decisions learned building it. Three things go with it:

- **Task files** hold the log: each task's Status and its completion notes.
- **`pnpm trace`** says what is built.
- **`.claude/status.md`** says where things stand.

The code is the truth for what is built, and the spec for what must be. When they
disagree, one of them has a defect.

Run it as `/docs land`, `/docs amend`, `/docs close`, `/docs lint`, or
`/docs <question>`. With no argument at the end of a task, run **land**.

## Land: finishing a task, on its branch

1. List what changed with `git diff --stat main...HEAD`, then reread the task file.
2. Check each requirement the task lists against the code. Every behavioral one,
   including ARCH ones, needs a test whose name starts with its ID (CONV-111), or an
   `ID: reason` entry under **Not tested**. OVR and CONV requirements are met by the
   code and `pnpm check`.
3. **Spec fixes.** Each fix the task made sits in its own `PN-TNN: spec:` commit and
   has a **Rulings** line naming the IDs (CONV-133). Amend by OVR-034:
   - rewrite the requirement in place and keep its ID;
   - a new requirement takes the next number in its prefix, at the end of its
     section (`grep -oh "RUL-[0-9]*" spec/*.md | sort -u | tail -1`, run on a branch
     rebased onto `main`);
   - a retired one is marked `(retired, PN-TNN)` with the reason.
4. **Closing sections** (OVR-035), in the document that governs each item:
   - a mistake that is easy to repeat goes under **Traps**;
   - a ruling that later work must respect goes under **Decisions** as one row,
     Decided by `Claude (ruling)`, or `owner` if Mike made it. One-off calls stay in
     the completion notes only;
   - a limitation or deferral goes under **Open**.

   Create a section the first time it's needed, after the last numbered section, in
   the order Traps, Decisions, Open.
5. Update the module READMEs whose public API changed (CONV-023).
6. Write the **Completion notes** in their five parts (CONV-135): Done, Rulings,
   Pending decisions, Not tested, Dependencies. A part with nothing in it says "None".
   Write Not tested as one `RUL-014: the reason` entry per requirement. Each pending
   decision gives its options and whether it blocks the task. A blocking one means the
   task is not done: commit the notes, so `/status` can read them from the branch,
   then stop and tell Mike. When Mike decides a question raised on the branch, mark it
   in place as `Decided YYYY-MM-DD: the answer` and commit that too.
7. Set **Status** to `Done`, rebase onto `main`, and run `pnpm check`. The docs check
   now holds the task to its notes. Quote the final summary line under **Done**.
8. Tell Mike what landed, the rulings, and the pending decisions. When he says the
   branch may be pushed, push it and open a pull request titled like the task file,
   whose body starts `Closes #N` for the task's issue (CONV-136):
   `gh issue list --label task --search "PN-TNN in:title"` finds N. After he merges,
   run `/status` on `main`.

## Amend: after Mike decides

1. Find everything the decision touches: grep `spec/` for the IDs and for the concept
   itself, across documents, tasks, fixtures, and reference code. Grep the code for
   `Implements` comments and test names that cite those IDs.
2. Edit the requirements by OVR-034. Change a fixture or reference file shown in a
   document together with its code block, so the drift check passes.
3. Record the decision in a **Decisions** row, Decided by `owner`. If it crosses
   documents, it also gets an ADR (OVR-036), `Accepted` because Mike has decided.
4. Tasks still `Not started` that list affected IDs get their Requirements and Design
   notes updated. A `Done` task's text stays as it was. A task added to a phase plan
   gets its GitHub issue (CONV-136).
5. Where to commit:
   - **A clarification the code already meets** goes on `main` as `spec: owner: …`.
   - **An amendment that retires an ID, or that existing code no longer meets,** goes
     in a task branch together with the code, so `pnpm check` passes on every commit to
     `main`. That is either the next task that touches the code, or a new task added to
     the phase plan.
6. Run `pnpm check`.

## Close: at the end of a phase

Write the phase plan's **Retrospective**:
- what differed from the plan, and why;
- the spec amendments, from `git log --oneline -- spec/`;
- the rulings later phases should know about;
- the work the phase deferred.

Take these from the tasks' completion notes and the documents' Open sections. Leave
unfinished work under Loose ends in the status log or in the Open section of the
document it concerns.

Then release the phase (CONV-137), once Mike has said `main` may be pushed:

1. Set the root `package.json` `version` to `0.N.0`, commit on `main` as
   `release: v0.N.0`, and tag it: `git tag -a v0.N.0 -m "Phase N: <name>"`.
2. Push `main` and the tag, then publish the release with the Retrospective as its
   notes: `gh release create v0.N.0 --title "v0.N.0: Phase N: <name>" --notes-file <file>`.
3. Close the milestone:
   `gh api -X PATCH repos/wardmanm/ProjectMythos/milestones/<number> -f state=closed`.

Run `/status`. The next phase's plan is written when that phase is reached
(00-overview §7). When its tasks are written, open one issue per task (CONV-136):
`gh issue create --title "<task title>" --label task --milestone "Phase N: <name>"
--body <body>`, then `gh project item-add 9 --owner wardmanm --url <issue url>`.

## Query: "how does X work?"

1. Read the governing section, then the closing sections of its document.
2. For what is built, use `pnpm trace` and the code (`grep -rn "Implements MEM-0"`).
3. Confirm the answer against the code before giving it.
4. If the document is wrong or silent, fix it in the same turn. If the answer is
   unambiguous, the fix is a ruling: outside a task branch, commit it on `main` as
   `spec: …`, give the reason in the commit message, and tell Mike. Otherwise raise it
   as a pending decision. Every question answered should leave the spec more accurate.

## Lint: auditing for drift

1. Run `pnpm check` (the docs check) and `pnpm trace`.
2. Take one document at a time, or the ones a phase touched. Read each requirement
   that a done task lists alongside the code that cites it.
3. Report contradictions, Traps that are no longer true, and Open items that are now
   done.
4. Fix what is unambiguous as rulings, in `spec:` commits whose messages give the
   reasons. List the rest for Mike as pending decisions.

## Writing the spec

| Write | Because |
|---|---|
| Requirements as `- **PREFIX-NNN** text`, with MUST, SHOULD, or MAY | The docs check finds definitions this way, outside the closing sections |
| `ts`, `json`, and `md` code blocks only for exact copies of a reference file or fixture | The drift check compares them; an illustration goes in a block with no language |
| Function and file names, never line numbers | Line numbers rot on the next edit above them |
| Relative links, and `NN-name.md §N` for sections | The docs check resolves both |
| Present tense for how it works | Superseded text is deleted, not kept "for history"; `git log` keeps it |

## Common mistakes

- **Appending "Update:" notes** instead of rewriting the requirement. The document
  then contradicts itself.
- **Renumbering or reusing an ID.** Tests and code cite them.
- **A ruling that is really a decision.** If it changes behavior or scope, raise it as
  a pending decision instead.
- **Writing progress into a document** ("implemented in P1-T05"). `pnpm trace` derives
  that.
- **Editing a done task's text** to match a later change. It records what that task
  did.
- **A page for every fix.** Fixes amend the topic's existing document; there is no
  separate wiki.
