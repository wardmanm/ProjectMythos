# @mythos/client

The React + Vite browser client. It is a view: the server owns every rule, roll, and
state change, and all model traffic goes through the server (ARCH-011, ARCH-012). It
depends on `@mythos/contracts` only.

## Scripts

- `pnpm --filter @mythos/client dev`: Vite's dev server.
- `pnpm --filter @mythos/client build`: a static build in `dist/`, which the server
  serves (ARCH-006).

`src/main.tsx` renders a heading until P1-T21 adds the routes, providers, and layout
shell.

## Governing spec

- [01-architecture.md](../../spec/01-architecture.md) §7
- [14-ui.md](../../spec/14-ui.md)
