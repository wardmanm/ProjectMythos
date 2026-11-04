# P1-T21: Client foundation

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] UI-132: a unit test feeds deltas with offsets, including one overlapping text already fetched, and the cached narration is exact.
- [ ] A test renders the shell in light and dark and checks the CSS variables match `theme.house`.
- [ ] An API error body becomes a typed error with its code; `auth_required` navigates to `/pin`.
- [ ] `pnpm --filter @mythos/client build` succeeds; no component imports `fetch` (lint or test).
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
