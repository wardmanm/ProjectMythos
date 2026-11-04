# ADR-012: Built-in node:sqlite on Node 26, behind a thin wrapper

- **Status:** Accepted
- **Date:** 2026-10-13
- **Requirements:** ARCH-002, CONV-055, CONV-084, CONV-091

## Context

Each campaign is a SQLite file, and the app must run on Windows x64 and macOS arm64.
Native modules such as `better-sqlite3` need a prebuilt binary for each platform and
Node ABI; when one is missing, installing needs a C++ toolchain, which is painful on
Windows. Node now ships SQLite: `node:sqlite` was added in 22.5, unflagged in 22.13
and 23.4, and became a release candidate (stability 1.2) in 25.7. Its API is
synchronous, like `better-sqlite3`.

Node 26 becomes Active LTS on 2026-10-28. In 26.11.0 (released 2026-10-08) the classes were renamed
`Database` and `Statement`; `DatabaseSync` and `StatementSync` remain as deprecated
aliases (DEP0210, DEP0211).

Checked on Node 26.11.1 (bundled SQLite 3.53.4): `exec`, `prepare` with `run`, `get`,
and `all`; transactions with `BEGIN`, `COMMIT`, and `ROLLBACK`; WAL mode; `STRICT`
tables; and Zod parsing of result rows, which have null prototypes. No experimental
warning is printed.

## Decision

- Require Node 26.11.0 or later, and use `node:sqlite`'s `Database` class.
- Only `apps/server/src/modules/storage/sqlite.ts` imports `node:sqlite`. It exposes a
  thin wrapper (open, close, exec, prepared statements, and `transaction(fn)` using
  `BEGIN IMMEDIATE`) that the rest of `storage` uses (CONV-055).
- `better-sqlite3` is the fallback. Its synchronous API is close enough that a switch
  changes only the wrapper. Switching needs an ADR and the CONV-084 binary check.

## Consequences

- No native dependencies at all, and nothing compiles at install time.
- The module is still a release candidate, so its API may change; only one file would
  change with it.
- Node 26.0 to 26.10 are not supported, because they lack the `Database` name.

## Alternatives considered

- **`better-sqlite3`.** Mature and fast, but native.
- **`sql.js` (WebAssembly).** No native code, but it runs in memory and writes whole
  files, which is unsafe for an append-only log.
