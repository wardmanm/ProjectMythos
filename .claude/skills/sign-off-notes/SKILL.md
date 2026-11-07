---
name: sign-off-notes
description: Use when Mike types /sign-off-notes, in a second window beside a phase sign-off (/docs close), to file a bug, change, or feature noticed while testing that fails no check.
disable-model-invocation: true
argument-hint: "[N], the phase being signed off, e.g. 1"
---

# Notes while signing off a phase

Mike ran `/sign-off-notes $ARGUMENTS` in a second window. In another window, `/docs
close` is walking Mike through a phase sign-off, one check at a time (CONV-139,
ADR-019). This window files what Mike notices along the way that **fails no check**:
bugs, changes, and features, each at P1 or P2 (CONV-141, ADR-021).

The `/docs close` window owns the checks and their results. This window only adds
issues, and a list of them to the phase plan.

**Who decides what.** Mike confirms each issue's title and Priority before anything
goes to GitHub (issues, milestones, board fields).

## Start

1. **Find the phase plan.**
   - With `$ARGUMENTS` (`N`, or `v0.N.0`), it's `spec/phases/phase-<N>.md`.
   - Without, it's the `spec/phases/phase-<N>.md` with the smallest N (compared as
     numbers) that has no `v0.N.0` tag (`git tag -l "v0.*"`).
   - If there's none, or the plan is already tagged, or it has no **Sign-off** table,
     say there's no sign-off in progress (`/docs close` starts one) and stop.
   - The table is often uncommitted on `main`. It's only up to date here if this window
     is open in the same folder as `/docs close`. If every cell is empty, ask whether
     `/docs close` is running in this folder.
2. **Say what you're following:**
   - the phase and its release, e.g. `Phase 1: Foundation, v0.1.0`;
   - the folder, `git rev-parse --show-toplevel`, so Mike can check it's the one
     `/docs close` runs in;
   - the column `/docs close` is filling, since each check is answered once per OS. It's
     this session's OS (`macOS` or `Windows`), unless Mike says the answers are for the
     other machine;
   - the commit being tested, `git rev-parse --short HEAD`, on `main`. If `git branch
     --show-current` names another branch, say so: what's running may not be `main`;
   - the check in progress (below).

   Then tell Mike how to write a note: a message starting `Bug -`, `Change -`, or
   `Feat -`.

**The check in progress** is the first row whose cell in the column is empty. If no
cell is empty, it's the first `skip`, because `/docs close` asks those again. If every
cell has another result, there's none: the walk-through on this OS is over.

## Each note

A message starting `Bug`, `Change`, or `Feat` (any case, followed by `-` or `:`) is a
note. Answer any other message if it's a question. If it reads like a note without a
prefix, ask whether it's a Bug, a Change, or a Feat.

1. **Read the plan again.** The `/docs close` window moves on as Mike answers, so an
   earlier read is out of date. Note the check in progress and `git rev-parse --short
   HEAD` now; the issue records both.
   - If `v0.N.0` is now tagged, the sign-off is over. Say so, and that the note can be
     filed as an ordinary issue instead. Then stop taking notes.
   - Check that every line you added to **Found while testing** is still there. If one
     is missing, tell Mike which, and add it back by step 11's rules.
   - **Open lines.** Each line you gave Mike in this section's step 2 stays open until
     the plan shows it was handled (that check's cell is a fail, or was cleared, or a new
     check covers it) or Mike says it's done. With every message, note or not, and
     before anything else, repeat each open line whose check has moved on without it.
     When Mike is finished, list every line still open before stopping. If that check now has a pass or a skip, give it as `Try S5 again: <what
     happened>`. Mike answers the check in progress first, so these come before this
     note's own answer.
2. **Does it fail a check?** Compare the note with every check's **Expect**, from S1 to
   the last, not only the one in progress. If it means an Expect didn't happen, don't
   file it here. Say which check, and give Mike one line to paste into the `/docs
   close` window, with what happened in Mike's words:

   | The note fails | The line |
   |---|---|
   | the check in progress | Choose **Fail** on S4 and say: `<what happened>` |
   | a check still to come | Paste now: `S9 will fail: <what happened>`. `/docs close` keeps it and shows it when S9 comes up |
   | a check whose cell has a result | Paste: `Try S4 again: <what happened>` |
   | nothing a check covers, but it blocks the release | Paste: `Add a check: <what happened>` |

   **Blocking the release** means lost data, a crash with no way back, a deliverable
   item that can't be done at all, or a security hole. If a note looks like one, ask in
   plain text whether it blocks the release. If Mike says no, go on and file it here.

   Only `/docs close` changes a result or adds a check. If the cell is a fail that
   already says this, the bug is filed: give its number instead. Then wait for the
   next note.
3. **Is it already planned?** The spec plans every phase. Search it (`grep -rn` in
   `spec/`, starting with 00-overview §7 and each document's phase table) for what the
   note asks for.
   - **A later phase plans all of it:** say which: the document, section, requirement,
     and phase. Ask in plain text whether to file it anyway. If not, stop here; if so,
     go on.
   - **A later phase plans part of it, or something close to it:** name that under
     **Specified in** (step 6), and go on.
4. **Settle the kind.**
   - **Bug:** something doesn't work as it should. Label: `bug`.
   - **Change:** alter something that already exists. Label: `enhancement`.
   - **Feat:** something new. Label: `enhancement`.
   - **Keep Mike's kind,** except when a requirement says otherwise: a Change or Feat
     that a requirement already promises is a Bug, and a Bug about something working
     as a requirement says is a Change. Then ask which kind before drafting, and say
     why. If Mike leaves it to you, follow the requirement and say which kind you chose.
5. **Draft the issue.** Write what Mike saw, in Mike's words, not a guess at the cause.
   Don't look into the code; whoever fixes it does that. Do find the spec section and
   requirement yourself (`grep -rn` in `spec/`). If an open `sign-off` issue already
   says the same (`gh issue list --label sign-off --state open --search "<words>"`),
   say so and ask whether to file it anyway.
   - **Follow-up questions:** ask only for what the issue can't do without. For a Bug,
     that's the steps or what Mike expected. For a Change or Feat, it's what Mike wants
     and why. Ask in plain text, one at a time, two or three at most.
6. **Write the body** with `###` headings:

   | Kind | Headings, in order |
   |---|---|
   | Bug | Version · Expected behavior is specified in · Steps to reproduce · Expected · Actual · Found during |
   | Change | Specified in · Requirements · What and why · Acceptance criteria · Found during |
   | Feat | The same as a Change, with Requirements set to `new` |

   - A Bug's **Version** is the branch, commit, and OS: `` `main` at `abc1234`, macOS ``.
   - A Bug's **Expected behavior is specified in** is each document, section, and
     requirement that says what should happen, e.g. `06-turn-engine.md §5.7, TRN-058`.
     List several if several apply. If none does, write `Not specified yet; it would
     belong in <document §>`.
   - **Specified in** is the document and section, e.g. `06-turn-engine.md §4`. If the
     spec doesn't mention it, write `Not specified yet; it would belong in <document §>`.
   - **Requirements** are the IDs it changes or falls under, e.g. `TRN-020`, or a
     schema by name when the rule is only in a schema. A Feat's are `new`.
   - Every kind ends with **Found during**. The check says when Mike noticed it, not
     what the issue is about, so name it by its number and name only, with no issue
     number, which would link the two:

     ```markdown
     ### Found during

     The phase 1 sign-off (v0.1.0) on macOS, testing `abc1234`, while on check S4 (Play *Arrival*).
     ```

     With no check in progress, write `after the last check` instead.
7. **Suggest a Priority,** with a one-line reason:
   - **P1** is wanted soon: a bug to fix early in the next phase, or a change or feature
     to consider for it. It goes in the next phase's milestone.
   - **P2** is deferred: for later. It gets no milestone.

   P0 never comes from this window (step 2).
8. **Confirm.** Show the draft: its kind, title, labels, and body. Then ask with
   `AskUserQuestion`, with the title in the question and three options: file it at the
   suggested Priority, file it at the other one, or change something first. Each
   filing option's description names its milestone, e.g. `P1: in Phase 2: Turn engine`
   and `P2: no milestone`. If Mike changes something, redraft and ask again. Post
   nothing until Mike chooses to file it.
9. **File it:**

   ```bash
   gh issue create --title '<title>' --label <bug|enhancement> --label sign-off --body-file - <<'EOF'
   <body>
   EOF
   ```

   The title is in single quotes, so `"`, `$`, and backticks in it are safe; write a
   `'` in it as `'\''`.

   For a P1, add `--milestone "Phase <N+1>: <name>"`; find the name with `gh api
   repos/wardmanm/ProjectMythos/milestones --jq '.[].title'`. If there's no next phase,
   give it no milestone. Never use the phase's own milestone.
10. **Set Priority on the board** (#9):

    ```bash
    gh project item-add 9 --owner wardmanm --url <issue url> --format json --jq .id
    gh project view 9 --owner wardmanm --format json --jq .id
    gh project field-list 9 --owner wardmanm --format json --jq '.fields[] | select(.name == "Priority")'
    gh project item-edit --project-id <project id> --id <item id> --field-id <field id> --single-select-option-id <option id>
    ```

    The first adds the card and prints its item id. The board's workflow may have added
    it already, and `item-add` then fails with "Content already exists". Find the item
    id instead with `gh project item-list 9 --owner wardmanm --format json --limit 1000
    --jq '.items[] | select(.content.number == <N>) | .id'`; without `--limit`, it lists
    only the first 30 cards. If Priority still can't be set, carry on and say so in
    step 12, so Mike can set it by hand.
11. **List it in the plan.** Read the plan just before editing it, because the `/docs
    close` window writes to it too. Add one line to the **Found while testing** list.
    If the label isn't there yet, add it, with a blank line before and after, after the
    paragraph that follows the Sign-off table and before the next `##` heading:

    ```markdown
    **Found while testing**

    - #31 Bug, P2, while on S4 (macOS): Opening narration repeats its last line
    ```

    The line is the number, kind, Priority, check and OS, then the issue's title, with
    no requirement IDs, ADR numbers, `spec/` paths, or § references: the docs check
    reads those in the plan. With no check in progress, write `after the last check
    (macOS)`. Change nothing else in the plan.
12. **Report:** the issue's link, Priority, and milestone. For a bug where a screenshot
    or a short recording would help, say that one can be dropped into the issue on
    GitHub, since `gh` can't attach it. With no check in progress, also say the line is
    uncommitted, and that `/docs close` commits it before the gate. Then wait for the
    next note.

## Limits

- Never change a Sign-off check, a cell of the Sign-off table, or any other part of the
  plan but the **Found while testing** list. Those belong to the `/docs close` window.
- Never give an issue P0, and never put one in the milestone of the phase being signed
  off.
- Never commit, push, or switch branches. Both windows share this checkout, and
  `/docs close` commits the list with the table's `spec: owner: phase N sign-off,
  <OS>` commit, or before the gate.
