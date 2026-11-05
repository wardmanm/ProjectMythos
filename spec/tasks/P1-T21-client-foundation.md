# P1-T21: Client foundation

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T02 |
| **Branch** | `p1-t21-client-foundation` |

## Goal

Set up the client every screen builds on: routing, the house theme as CSS
variables with bundled fonts, the typed API layer, TanStack Query, per-campaign SSE
that updates the cache, the layout shell, and the PIN redirect.

## Read

- `spec/14-ui.md` §1, §2, §3 (all), §4, §12, §13, §14, §16 (UI-132)
- `spec/01-architecture.md` §7 (ARCH-120 to ARCH-122)
- `spec/03-contracts.md` §13, §14
- `spec/02-conventions.md` §12
- `spec/decisions/ADR-013-themes-as-data.md`

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-120, ARCH-121, ARCH-122, UI-001, UI-030, UI-032, UI-033, UI-034, UI-040, UI-042, UI-100, UI-101, UI-102, UI-110, UI-113, UI-114, UI-120, UI-122, UI-132, CONV-100, CONV-101, CONV-102, CONV-103

## Outputs

- `apps/client/`: Vite with React and `@tailwindcss/vite`, shadcn/ui initialized (`components.json`, `src/components/ui/`), `src/app/` (router, providers, layout shell), `src/api/` (client and hooks), `src/events/` (SSE), `src/theme/` (theme to CSS variables, fonts), `src/stores/`, tests
- Routes from UI §2 that phase 1 uses, each with a placeholder screen: `/`, `/new`, `/c/:campaignId`, `/c/:campaignId/inspector/:turnId`, `/settings`, `/pin`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- `apps/server/`

## Design notes

- **Theme.** Phase 1 uses `theme.house` everywhere (14-ui §15). Import its JSON from
  `content-library/themes/theme.house.json` at build time, parse it with `ThemeSchema`,
  and write its tokens as CSS custom properties on the root (UI-032), following the
  device's light or dark preference (UI-033). Bundle its two faces with `@fontsource`
  (Literata, Atkinson Hyperlegible). Tailwind reads colors and fonts from the
  variables, so later themes need no component changes.
- **API layer** (ARCH-122): one `fetch` wrapper that sends JSON, parses every response
  with its contract schema, turns error bodies into typed errors, and redirects to
  `/pin` on `auth_required`. Hooks per route; no component calls `fetch`.
- **Events** (UI-101, UI-132): one `EventSource` per open campaign at
  `/api/campaigns/:campaignId/events`, parsed with `ServerEventSchema`. `narration.delta`
  writes at its `offset` into the cached turn, so text already fetched is not repeated;
  other events update or invalidate queries as UI-101 lists. Components never
  subscribe to SSE directly (ARCH-120).
- Zustand holds UI state only (ARCH-121). Per-device preferences come in later phases.
- The shell: a top bar and a content area, phone-first, with no horizontal scroll from
  360 px (UI-042). Every control is keyboard reachable with a 44 px target (CONV-103).
- `vite.config.ts` proxies `/api` (including the event stream) to the server's port in
  development.
- Component tests use Vitest with `jsdom` and Testing Library (CONV-091); set them up
  here so the screen tasks only write tests.

## Acceptance

- [x] UI-132: a unit test feeds deltas with offsets, including one overlapping text already fetched, and the cached narration is exact.
- [x] A test renders the shell in light and dark and checks the CSS variables match `theme.house`.
- [x] An API error body becomes a typed error with its code; `auth_required` navigates to `/pin`.
- [x] `pnpm --filter @mythos/client build` succeeds; no component imports `fetch` (lint or test).
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/client/` is the base for every phase-1 screen:
    - `src/app/`: a data-mode router (`routes`, `createAppRouter`) with placeholder
      screens at `/`, `/new`, `/c/:campaignId`, `/c/:campaignId/inspector/:turnId`,
      `/settings`, and `/pin`, and a not-found screen; `AppShell` (top bar with the
      menu and the app's name, a `min-w-0` content area, the notice line);
      `CampaignLayout`, which holds the campaign's event stream; `createQueryClient`;
      and `createApp`, which wires a router to a query client for `main.tsx` and tests.
    - `src/theme/`: `theme.house` parsed with `ThemeSchema` and written onto `<html>`
      as 19 custom properties, `color-scheme`, and the `dark` class, following the
      device's light or dark preference; `chooseTheme` (UI-030); Literata and
      Atkinson Hyperlegible bundled at 400, 400 italic, and 700.
    - `src/index.css`: Tailwind's own colors, fonts, and radii cleared, the theme's
      tokens declared, and shadcn/ui's names mapped onto them.
    - `src/api/`: `request` and `requestNoContent`, typed `ApiFailure`s carried as an
      `Error`'s `cause`, `plainWords`, `queryKeys`, and `useCampaign`.
    - `src/events/`: one `EventSource` per open campaign, a listener per payload
      type, deduplication by event ID, reopening after 1, 2, 5, 10, then 30 s, and
      `applyServerEvent`, which writes narration deltas by offset.
    - The twelve shadcn/ui components, each control at least 44 px; the notice store,
      `Notice`, `FailureMessage`, and `StoryColumn`; test setup with fakes for
      `fetch`, `EventSource`, and `matchMedia`, `renderApp`, and fixtures.
    - Lint: `fetch` only in `src/api/`, `EventSource` only in `src/events/`. The root
      Vitest config runs the client as its own jsdom project.
  - Acceptance, by test: UI-132's offsets in `narration-delta.test.ts` and
    `apply-server-event.test.ts`; light and dark variables in `theme-root.test.tsx`;
    typed failures in `client.test.ts` and the `/pin` redirect in
    `query-client.test.tsx`; the lint test in `scripts/lint-rules.test.ts`.
  - `pnpm --filter @mythos/client build` succeeds. Vite warns that the one script
    chunk is 613 kB, over its 500 kB hint; the app is served on the LAN, so it is not
    split.
  - `pnpm check` passes. The workspace has `Tests  270 passed (270)` (68 in the
    client) and `spec/reference` `Tests  271 passed (271)`, and it ends with `Docs check
    passed: 834 requirements, 25 tasks (6 done), 20 ADRs, 76 markdown files, 356
    citations in code.`
- **Rulings:**
  - **Mike's decisions** (`P1-T21: spec: owner:` commits): `cn`, `tw-animate-css`,
    `shadcn` (dev), and `@testing-library/dom` are on CONV-091's list, with a row in
    02-conventions' Decisions; the twelve components; the browser's `EventSource`;
    ADR-020 written as Proposed; and, decided during the task, lint and tests ignore
    `.claude/worktrees/` (a 02-conventions Decisions row and a lint test).
  - **Versions.** `@tanstack/react-query` 5.105.3, `lucide-react` 1.68.0, and `jsdom`
    30.1.3, not the plan's 5.106.1, 1.69.0, and 31.0.0. Those were published hours
    earlier, and `pnpm add` would have written them into `minimumReleaseAgeExclude` in
    `pnpm-workspace.yaml` to get past pnpm's release-age check; jsdom 31 was also a new
    major. The newest versions old enough to pass are used, and `pnpm-workspace.yaml`
    is unchanged. 01-architecture Traps records how `pnpm add` does this.
  - **`zod` 4.6.5 in the client**, the contracts' version: `request` takes a Zod schema,
    and `ApiFailure` is a Zod type. It is on CONV-091's list.
  - **No Geist.** shadcn init added `@fontsource-variable/geist` and its import; both
    are removed, since `theme.house` names its own faces (UI-034).
  - **Component edits** (CONV-102, noted at the top of each file): every button size
    is at least 44 px, with `lg` and `icon-lg` at 48 so they stay larger; the input,
    select trigger and items, tab triggers, and menu items are at least 44 px; the
    switch keeps its look and gets a hit area of at least 44 px. Focus rings use the
    whole accent, not half (UI-110). Two raw colors the cleared palette no longer
    defines became tokens: the secondary button's hover and the dialog overlay
    (UI-032). Label, card, alert, and textarea needed nothing; the badge only its ring.
  - **Token mapping** (14-ui Decisions): beyond the plan's list, muted, secondary, and
    input map to border; the foregrounds to text; primary-foreground to onAccent.
    Fallbacks in `index.css` are CSS system colors, so no theme's values are copied
    into CSS.
  - **The `dark` class** (14-ui Decisions): `ThemeRoot` sets it from the applied
    palette, so the components' `dark:` styles are right for a one-palette theme.
  - **Events.** The `error` payload is told apart from the connection's own error
    event (14-ui Traps). A reopened stream refetches every key of the campaign, as
    `resync.required` does, since the missed events could touch any of them.
    `narration.done` and an `error` for a turn refetch the turn's own key and each
    branch list holding it, since deltas are written to both. An event whose ID is not
    above the last one delivered is skipped; a fresh stream resets that, in case a
    restarted server's IDs are lower.
  - **Commands are never retried**: a second POST could act twice. Queries retry only
    `unreachable`, twice.
  - **Play's placeholder** fetches the campaign and marks its story with
    `data-branch-id`, so UI-001's test can see the branch; P1-T23 replaces it.
    `CampaignLayout` fetches nothing.
  - **Extra files** (CONV-132): `src/features/*` placeholders,
    `src/components/{notice,failure-message,story-column}.tsx`, `src/lib/utils.ts`
    (shadcn's `utils` alias), `src/api/plain-words.ts`, `src/test/*`, the root
    `vitest.config.ts`, `eslint.config.js`, and `scripts/lint-rules.test.ts`.
  - **Spec fixes** (`P1-T21: spec: event handling, global CSS, and the client's
    closing sections`): UI-101 now covers `narration.done`, `error`, and `job.updated`,
    a gap refetching the turn, `turn.created` refetching the branch's turns and the
    campaign, and `state.changed` refetching the journal. CONV-101 allows the base
    rules that apply the tokens. 14-ui gains Traps (a listener per named event; the
    `error` name; resuming is the browser's job, UI-132; a fetch overwriting in-flight
    deltas), Decisions, and an Open entry for the other eight fonts (UI-034).
    02-conventions Decisions: errors carry their failure as `cause` (CONV-007), and
    the `@/` alias.
  - **The dev proxy's `xfwd`** (01-architecture Decisions): proxied requests carry
    `X-Forwarded-For`, so P1-T16's PIN lock, which never exempts a forwarded request,
    treats a LAN device using the dev server as remote. The host machine also needs
    the PIN in development when one is set.
- **Pending decisions:**
  - Accept ADR-020 (native build tools: `@tailwindcss/oxide`, `rolldown`,
    `lightningcss`). Options: accept it; or reject it, which means a different CSS and
    bundling setup than Tailwind 4 and Vite 8. Blocks: the merge, not the task.
    Decided 2026-11-05: accepted; ADR-020's status is Accepted.
- **Not tested:**
  - ARCH-121: the only store holds a notice, text written for the player, not server
    data; there is no behavior to show.
  - UI-042: jsdom does no layout; P1-T23 and P1-T25 measure horizontal scrolling at
    360 px with Playwright (UI-131).
  - UI-113: a CSS media rule; jsdom applies no stylesheets.
  - The Vitest exclusion of `.claude/worktrees/` has no test; lint's has one.
- **Dependencies:**
  - Runtime, all on CONV-091's list: `react-router` 8.5.1, `@tanstack/react-query`
    5.105.3, `zustand` 5.0.16, `radix-ui` 1.8.1, `class-variance-authority` 0.7.1,
    `lucide-react` 1.68.0, `@fontsource/literata` 5.3.0,
    `@fontsource/atkinson-hyperlegible` 5.3.0, `cn` 0.5.2, and `zod` 4.6.5.
  - Tooling: `tailwindcss` 4.3.4 and `@tailwindcss/vite` 4.3.4, which brings the native
    `@tailwindcss/oxide` (ADR-020); `shadcn` 4.23.0; `tw-animate-css` 1.4.0;
    `jsdom` 30.1.3, `@testing-library/react` 16.3.3, and `@testing-library/user-event`
    14.6.8, for component tests; `@testing-library/dom` 10.4.2, the required peer of
    `@testing-library/react`.
  - Not added: happy-dom, jest-dom, and the TanStack devtools.
