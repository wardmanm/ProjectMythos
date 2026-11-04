# P1-T23: Client: play screen and inspector

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] Component tests: streaming text appears in order; Stop calls cancel; a failed turn offers Retry; the dock explains why it is disabled.
- [ ] At 390 px wide the input dock stays visible and nothing scrolls horizontally.
- [ ] Component tests render a recorded `ModelCallRecord` fixture with two attempts and four tiers in the inspector, on desktop and phone widths.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
