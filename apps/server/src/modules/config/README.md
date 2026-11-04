# config

Machine config and the data directory. It finds the data directory, writes the default
`machine-config.json` on first start, loads and checks it, saves edits from settings
atomically, and keeps inline secrets and the PIN hash out of every response. It imports
no other module (ARCH-021).

## Public API (`index.ts`)

- `openConfig(options)` opens the config and returns `{ store, created }`. It is called
  once, by the composition root (ARCH-022), with the `--data-dir` flag, the platform,
  the environment, the home folder, and the working folder. `created` says whether the
  default was just written, for the caller to log. A file that fails to load is never
  replaced: the store holds its issues instead.
- `ConfigStore`:
  - `configPath` and `dataDir`, which are fixed until restart.
  - `current()` returns the config in effect, or the `validation_failed` error with
    every issue.
  - `save(incoming)` puts stored secrets back, validates, writes atomically, and makes
    the result current. It returns the saved config with secrets replaced, and
    `restartRequired`.
- `defaultDataDir(platform, env, homedir)` gives the OS default data directory.
- `resolveSecret(secret, env)` gives a secret's value, or `not_configured` when its
  environment variable is missing.
- `redact(config)` replaces every inline API key and the PIN hash with
  `SECRET_PLACEHOLDER`, before a config leaves the server.
- `mergeSecrets(incoming, stored)` puts stored secrets back where a save sent the
  placeholder.

The module has no logger. Never log a config object (CONV-072).

## Files

- `data-dir.ts`: the OS default and the order flag, then config, then default.
- `machine-config.ts`: the default, parsing, the atomic write, and the store.
- `cross-references.ts`: the checks after the schema.
- `secrets.ts`: `resolveSecret`, `redact`, `mergeSecrets`.

## Governing spec

- [05-providers.md](../../../../../spec/05-providers.md) §2: the schema and PRV-001 to
  PRV-005.
- [01-architecture.md](../../../../../spec/01-architecture.md) §4.1: the data
  directory (ARCH-030 to ARCH-032).
- [03-contracts.md](../../../../../spec/03-contracts.md): CON-091 (issues) and
  CON-111 (secrets).
