# @mythos/client

The React + Vite browser client. It is a view: the server owns every rule, roll, and
state change, and all model traffic goes through the server (ARCH-011, ARCH-012). It
depends on `@mythos/contracts` only.

## Scripts

- `pnpm --filter @mythos/client dev`: Vite's dev server. It proxies `/api`, the event
  stream included, to the server on `localhost:5317`, marking each request as forwarded
  so the PIN lock never takes it for localhost (ARCH-111).
- `pnpm --filter @mythos/client build`: a static build in `dist/`, which the server
  serves (ARCH-006).
- Tests run with the rest of the workspace (`pnpm test`); the root `vitest.config.ts`
  runs this package's `vite.config.ts` as its own project, with jsdom.

## Layout (ARCH §7)

Imports inside the client use the `@/` alias for `src/` (`tsconfig.json` paths).

| Folder                 | Holds                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `src/app/`             | The router, the providers, the query client, the layout shell, and the campaign layout  |
| `src/features/<name>/` | One folder per screen. Phase 1's are placeholders that their screen tasks fill in place |
| `src/api/`             | The only `fetch` caller, and the query hooks built on it (ARCH-122)                     |
| `src/events/`          | The only `EventSource`, and what each event does to the cache (ARCH-120)                |
| `src/theme/`           | The house theme, bundled fonts, and theme-to-CSS-variable code (UI-032)                 |
| `src/stores/`          | Zustand stores for UI state only (ARCH-121)                                             |
| `src/components/ui/`   | shadcn/ui's generated components. Each edit is noted at the top of its file (CONV-102)  |
| `src/components/`      | Shared presentational components                                                        |
| `src/test/`            | Test setup and fakes for `fetch`, `EventSource`, and `matchMedia`                       |

Lint enforces the `api/` and `events/` boundaries: `fetch` anywhere else in `src/`, or
`EventSource` outside `events/`, is an error.

## Routes (14-ui §2)

`src/app/router.tsx` holds the table; `createAppRouter()` builds the browser's router,
and tests mount `routes` in a memory router. `AppShell` is the root layout, and
`CampaignLayout` wraps every `/c/:campaignId/…` screen and holds its event stream.

| Route                              | Screen       | File                                            |
| ---------------------------------- | ------------ | ----------------------------------------------- |
| `/`                                | Library      | `features/library/library-screen.tsx`           |
| `/new`                             | New campaign | `features/new-campaign/new-campaign-screen.tsx` |
| `/c/:campaignId`                   | Play         | `features/play/play-screen.tsx`                 |
| `/c/:campaignId/inspector/:turnId` | Inspector    | `features/inspector/inspector-screen.tsx`       |
| `/settings`                        | Settings     | `features/settings/settings-screen.tsx`         |
| `/pin?next=<address>`              | PIN          | `features/pin/pin-screen.tsx`                   |
| anything else                      | Not found    | `app/not-found-screen.tsx`                      |

## API layer (`src/api/`)

- `request(path, schema, { method, body, signal })` fetches `/api<path>` and returns the
  body parsed with `schema`; `requestNoContent` is the same for a `204`. Both throw a
  plain `Error` whose `cause` is an `ApiFailure`: `server` (the server's error body,
  with its status and `AppError`), `unreachable` (no answer, or an error answer that is
  not the server's), or `invalid-response` (a success body that fails its schema).
- `apiFailureOf(error)` and `errorCodeOf(error)` read a failure back from anything
  thrown; `plainWords(failure)` and `wordsForCode(code)` give the words to show
  (UI-122). Never show a code or a server message.
- `queryKeys` names every key (UI-100). A campaign's keys have its ID second, which
  `resync.required` relies on. The cached data is: `['campaign', c]` a `CampaignView`,
  `['turns', c, b]` a `TurnView[]` oldest first, and `['turn', c, t]` a `TurnView`.
- `useCampaign(campaignId)` is the first hook. Add a hook per route in a file named for
  its area.

The query client (`src/app/query-client.ts`) sends `auth_required` from any query or
command to `/pin?next=<address>`, and on `conflict` refetches everything and shows the
notice (UI-102). It retries only `unreachable`, twice, and never a command. Commands are
mutations that leave the cache alone: the events update it.

## Events (`src/events/`)

`CampaignLayout` calls `useCampaignEvents(campaignId)`, which opens one browser
`EventSource` for the campaign (`openCampaignEvents`) and closes it when the player
leaves. Each frame is parsed with `ServerEventSchema`; one that fails, or is for another
campaign, is treated as `resync.required`. An event already delivered is skipped.
`applyServerEvent` does what UI-101 lists, and `writeNarrationDelta` writes a delta at
its offset into every cached copy of the turn, refetching the turn when there is a gap.
The browser resumes a dropped stream with `Last-Event-ID` on its own; when it gives up,
the client reopens the stream after 1, 2, 5, 10, then every 30 seconds, and refetches
the campaign once it is open.

## Theme (`src/theme/`)

`houseTheme` is `content-library/themes/theme.house.json`, parsed with `ThemeSchema`.
`applyTheme` writes `themeVariables(theme, scheme)` onto `<html>`: the 11 `--color-*`
palette colors, `--font-narration`, `--font-interface`, `--font-display`,
`--font-mechanics`, `--narration-size`, `--narration-line-height`,
`--narration-measure`, and `--radius`, plus `color-scheme` and the `dark` class.
`ThemeRoot` keeps them current as the device's light or dark preference changes.
`chooseTheme` holds UI-030's order; phase 1 always passes the house theme.

`src/index.css` clears Tailwind's own colors, fonts, and radii, declares the theme's
tokens, and maps shadcn/ui's names onto them (14-ui Decisions). So components use
classes such as `bg-surface`, `text-text-muted`, `font-narration`, or shadcn's
`bg-primary`, never a raw color. `StoryColumn` is the story's measure-wide column
(UI-040).

## Testing

`src/test/setup.ts` gives every test a fake `fetch` (`answer`, `fetchCalls`), a fake
`EventSource` (`latestEventSource().open()`, `.send(event)`, `.drop()`, `.fail()`), and
a fake `matchMedia` (`setDevicePrefersDark`), and cleans up after it.
`renderApp(path)` renders the whole app at a URL with a memory router and returns the
router, the query client, and a user-event session. `fixtures.ts` builds valid campaign
views, turn views, and server events.

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §7
- [14-ui.md](../../spec/14-ui.md)
- [02-conventions.md](../../spec/02-conventions.md) §12
