# P1-T23: Client: play screen and inspector

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T20, P1-T21 |
| **Branch** | `p1-t23-client-play-and-inspector` |

## Goal

Read and play: the story column with streaming narration, the input dock with
Stop, turn status lines, and failure recovery. Then the inspector, opened from each turn,
which shows every model call for that turn in its Prompt and Output tabs.

## Read

- `spec/14-ui.md` §4, §5.1, §5.3, §7.1, §9 (UI-090, UI-091), §13, §15 (phase 1 row)
- `spec/06-turn-engine.md` §3, §5.4, §10
- `spec/09-context.md` §9 (CTX-090)
- `spec/03-contracts.md` §13, §14 (model call records and their routes)

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

UI-040, UI-042, UI-043, UI-050, UI-051, UI-053, UI-054, UI-059, UI-073, UI-074, UI-090, UI-112, UI-135, TRN-058

## Outputs

- `apps/client/src/features/play/` (screen, story, turn, input dock, tests)
- `apps/client/src/features/inspector/` (screen, tabs, tests), opened by an **Inspect** link on each turn

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- `apps/server/`

## Design notes

- **Play screen.** Build it first.
  - Load turns with `GET /branches/:branchId/turns`, newest last, paging older turns as
    the reader scrolls up.
  - Story: the player's input in the narration face and `playerText` color (UI-050),
    narration at the theme's size (UI-051), streaming as UI-053 describes, a quiet
    status line while work is underway (UI-054), and a polite live region announcing
    new narration (UI-112).
  - Input dock: in-character only in phase 1 (no mode switch yet). Enter sends on
    desktop and Shift+Enter adds a line (UI-074). While narration streams, the send
    button is **Stop** (UI-135). When input is unavailable, the dock says why (UI-073).
  - A `stage-failed` turn shows what happened and a **Retry** button (UI-059, phase 1
    subset), which calls `regenerate` for the narration.
  - Top bar: campaign name and the head turn's date label.
- **Inspector.**
  - The call list shows role, model, duration, tokens in and out, and outcome.
  - Choosing a call shows two tabs:
    - **Prompt:** each tier as a section with its budget bar, estimated tokens, what
      was trimmed, and a mark on cached-prefix tiers;
    - **Output:** raw output, thinking if any, parsed output, and every attempt with
      its issues.
  - The Memories and Templates tabs arrive in later phases.
  - Tables become stacked rows on phones (UI-042).

## Acceptance

- [x] Component tests: streaming text appears in order; Stop calls cancel; a failed turn offers Retry; the dock explains why it is disabled.
- [x] At 390 px wide the input dock stays visible and nothing scrolls horizontally.
- [x] Component tests render a recorded `ModelCallRecord` fixture with two attempts and four tiers in the inspector, on desktop and phone widths.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - **Play screen** (`apps/client/src/features/play/`): the current branch's turns, oldest
    first, in a growing window of the newest 50, with more loaded near the top or by
    **Show earlier turns**. Each turn shows its input (UI-050), its narration (UI-051), a
    quiet status line (UI-054), a failure card with **Retry** and **Cancel turn**
    (UI-059), and an **Inspect** link. Narration streams as it arrives, a whole sentence
    at a time under reduced motion, followed only for a reader at the bottom, with "New
    text below" for anyone else (UI-053). New narration is announced in a polite live
    region, a sentence at a time (UI-112). The input dock sticks to the bottom in the
    story's measure-wide column (UI-040, UI-043): Enter sends on desktop and adds a line
    on a phone, never during composition (UI-074); Send becomes **Stop** while narration
    streams (UI-135); unavailable input is read-only and says why (UI-073, TRN-058); and
    the draft is kept per campaign on the device.
  - **Inspector** (`apps/client/src/features/inspector/`): a turn's model calls (role,
    model, duration, tokens, outcome, attempts) as a table, or stacked rows on a phone
    (UI-042), and the chosen call's **Prompt** tab (each tier's budget bar, estimate,
    trims, and cached-prefix mark, then the messages as sent) and **Output** tab (raw
    output, thinking, parsed output, and every attempt with its issues) (UI-090). The
    call and tab are in the address (UI-001).
  - **Top bar** (Mike's Q1): on a campaign's screens the shell's sticky bar shows the
    campaign's name and the head turn's date in game.
  - Acceptance, by test: streaming in order in `play-screen.test.tsx`; Stop, the reason
    line, and the Enter rules in `input-dock.test.tsx`; Retry and Cancel turn in
    `turn-block.test.tsx`; scrolling and paging in `story-scroll.test.tsx`; and
    `recordedCall()`, four tiers and two attempts, at 1440 and 390 px in
    `inspector-screen.test.tsx`.
  - **390 px, checked by hand** in Playwright's Chromium at 390 × 844, on a built client
    served by `tsx src/main.ts --data-dir <scratch> --port 5399`, with a mock narrator
    (`delayMs` 250) and Arrival created with curl, then nine more turns. With the story
    taller than the screen, while a turn streamed, and on the inspector's Prompt and
    Output tabs: `scrollWidth` 375 (the scrollbar takes 15 px) ≤ `innerWidth` 390, and the
    dock's bottom at 843.9 ≤ `innerHeight` 844. A short story also keeps the dock at the
    bottom. Stop mid-stream kept the text and showed "The narration stopped before the
    end." At 1440 px the inspector is a table with no sideways scroll. The check found
    one bug, now fixed and tested: a text box that grew a line pushed the story's end
    under the dock.
  - `pnpm check` passes: the workspace has `Tests  1191 passed (1191)` (123 in the
    client) and `spec/reference` `Tests  273 passed (273)`, and it ends with `Docs check
    passed: 835 requirements, 25 tasks (22 done), 21 ADRs, 87 markdown files, 1564
    citations in code.`
- **Rulings:**
  - **Mike's decisions** (2026-11-07), each a 14-ui Decisions row: Q1 (a), one top bar
    with the campaign's name and date, sticky on every screen, and the play screen's h1
    visually hidden; Q2 (b), **Cancel turn** beside Retry on any failed turn after the
    opening.
  - **14-ui Decisions rows** (Claude): the turn window `['turns', c, b, n]`; a phone is
    below 640 px; unavailable input is a read-only text box with no Send; the
    inspector's call and tab in the address; the expected head is the last listed turn
    that isn't abandoned; parsed output is worked out from the raw output for display.
  - **14-ui Traps**: an abandoned turn stays in the cached list; the Enter that ends a
    composition; scroll anchoring; jsdom's missing layout and `scrollTo`; the query
    cache's notification timer. **14-ui Open**: no tier-to-text link in the record; the
    top bar's date from phase 3; reduced motion follows the system only; "how long" in
    UI-073; no phase for the Templates tab and "Open in preview".
  - **One-off calls.** The budget bar's fill is the one inline `style`, a width
    (CONV-101). The failure card's words are general, since the error is not kept
    (06-turn-engine Open). The top bar's date comes from `GET /turns/:headTurnId`. A
    reader at the bottom also stays there when the page grows without new text, such as
    when the dock's text box gains a line (found at 390 px). After Send, the dock says
    "Sending…" until the new turn is listed. The announcer treats a turn first seen
    while narrating, or deeper than any seen before, as new, and any other as history.
    A failed background refetch leaves the story and the dock as they were.
  - **Extra files** (CONV-132): `src/api/turns.ts` and its test, `src/api/model-calls.ts`
    (ARCH-122 keeps `fetch` in `api/`); `src/api/query-keys.ts` and its test (the three
    keys after `turn:`); `src/lib/use-media-query.ts`; `src/test/fake-match-media.ts`
    (widths and reduced motion) and `src/test/setup.ts` (stubs `scrollTo`, clears
    `localStorage`); `apps/client/index.html` (`interactive-widget=resizes-content`,
    UI-043); `src/app/app-shell.tsx` (Q1, and a grid so a screen can fill the height);
    and `apps/client/README.md`.
- **Pending decisions:** None.
- **Not tested:**
  - UI-042: that no screen scrolls sideways from 360 px needs layout, which jsdom lacks.
    It was checked by hand at 390 px (Done), and UI-131's Playwright run measures it.
  - UI-043: whether a phone's keyboard covers the dock depends on its browser honoring
    `interactive-widget=resizes-content`; jsdom has no keyboard.
  - UI-073: "how long" input stays unavailable has nothing to count in phase 1 (14-ui
    Open).
  - UI-090: the Memories and Templates tabs arrive in later phases (14-ui §15).
  - UI-112: dice cards, announced by their one-line summary, arrive in phase 3.
  - UI-059: badges for stale stages, extraction and world-tick failures, and replay
    conflicts, and the turn menu that lists them, arrive in phases 2 to 4.
- **Dependencies:** None.
