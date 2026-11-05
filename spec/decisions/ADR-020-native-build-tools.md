# ADR-020: Native build tools with prebuilt binaries

- **Status:** Proposed
- **Date:** 2026-11-05
- **Requirements:** CONV-084, OVR-001

## Context

CONV-084 says the project has no native dependencies, and that adding one needs an ADR
confirming prebuilt binaries for `win32-x64` and `darwin-arm64` on the pinned Node
version (ADR-012). The client's build has three:

- `@tailwindcss/oxide`, Tailwind 4's class scanner, which `@tailwindcss/vite` brings
  (P1-T21);
- `rolldown`, Vite 8's bundler, and `lightningcss`, its CSS transformer, which Vite and
  Vitest have brought since P1-T01, with no ADR until now.

Each is a Rust addon on Node-API. Its binaries are published as one package per platform,
listed in its `optionalDependencies` with `os` and `cpu` fields, so pnpm installs only
the one that matches. Node-API is stable across Node versions, so the binaries do not
depend on Node 26, and each package's `engines` admits it (`>=20`, `^20.19.0 ||
>=22.12.0`, `>=12.0.0`). esbuild, which tsx and Vite use, ships its binary the same way
but runs an install script, approved in `pnpm-workspace.yaml` (01-architecture
Decisions).

Checked with `npm view` on 2026-11-05:

| Package | Version | darwin-arm64 | win32-x64 | Install script |
|---|---|---|---|---|
| `@tailwindcss/oxide` | 4.3.4 | `@tailwindcss/oxide-darwin-arm64` | `@tailwindcss/oxide-win32-x64-msvc` | None |
| `rolldown` | 1.2.16 | `@rolldown/binding-darwin-arm64` | `@rolldown/binding-win32-x64-msvc` | None |
| `lightningcss` | 1.33.0 | `lightningcss-darwin-arm64` | `lightningcss-win32-x64-msvc` | None |

The platform packages have no install scripts either. pnpm also installs
`@tailwindcss/oxide-wasm32-wasi` everywhere, a WebAssembly fallback that is not native.

## Decision

The three are allowed as build tools: dev dependencies of the client and the workspace,
used by `vite`, `vite build`, and Vitest. None runs in the server, and none ships in the
built client. An upgrade keeps them only while each still has prebuilt packages for both
platforms and no install script; a version that breaks either is a pending decision.
No `allowBuilds` entry is needed.

CONV-084 still holds for everything the server runs: it has no native code, and SQLite
is Node's built-in `node:sqlite` (ADR-012).

## Consequences

- Tailwind 4 and Vite 8 work as published, on both systems, with no compiler installed.
- A platform with no prebuilt package cannot build the client. Linux and Windows on Arm
  have packages too, but only the two systems of OVR-001 are checked.
- Each upgrade of Vite, Vitest, or Tailwind repeats the check in the table above.

## Alternatives considered

- **Tailwind 3 with PostCSS.** No native scanner, but the previous major version, and
  Vite 8 would still bring rolldown and lightningcss.
- **Vite 7 with Rollup.** Rollup 4 has native binaries of its own, so nothing is gained.
- **No Tailwind.** Against the client stack in 00-overview §4 and CONV-101.
