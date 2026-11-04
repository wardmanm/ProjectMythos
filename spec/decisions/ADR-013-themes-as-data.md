# ADR-013: Themes as validated data with bundled fonts

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** UI-030 to UI-036

## Context

Each campaign should look like its genre, on desktop and phone alike. The app runs on
a LAN and must work offline. Text must stay readable whatever a pack author picks.

## Decision

- A theme is a JSON file (`theme.<slug>`): light and/or dark palettes, fonts, narration
  size and measure, corner radius, and ornaments. A tone profile names its theme, and
  the reader's own preference overrides it (UI-030).
- `themeIssues` checks WCAG contrast for every text and accent pairing. A theme that
  fails cannot be used.
- Themes become CSS custom properties; components use tokens only.
- Fonts are bundled: ten SIL Open Font License families from `@fontsource`, or `.woff2`
  files a pack ships with their license. Nothing loads from the network.
- Textures are generated in CSS, never images. Six built-in themes ship in the library.

## Consequences

- Any theme from any pack is readable, and works offline.
- Pack authors cannot inject CSS, so themes cannot break layout or accessibility.
- Font choice is limited to the bundled set plus pack fonts.

## Alternatives considered

- **A CSS file per theme.** Unlimited, unvalidated, and able to break the layout.
- **Web fonts from a CDN.** Fails offline.
