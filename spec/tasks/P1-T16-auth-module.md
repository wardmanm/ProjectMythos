# P1-T16: Auth module: PIN and sessions

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Done |
| **Depends on** | P1-T06 |
| **Branch** | `p1-t16-auth-module` |

## Goal

The optional PIN lock: hashing, login with rate limiting, session cookies, and the
localhost exemption.

## Read

- `spec/01-architecture.md` §6.4 (ARCH-110, ARCH-111)
- `spec/03-contracts.md` §14 (`SetPinCommand`, `SessionState`, `PinLoginCommand`, CON-113)
- `spec/00-overview.md` OVR-004
- `spec/02-conventions.md` CONV-072

## Requirements

Implement every ID below. Each behavioral requirement needs a test whose name starts
with its ID (CONV-111); one that a test cannot show gets an `ID: reason` entry under
**Not tested**. OVR and CONV requirements are met by the code and `pnpm check` (OVR-038).

ARCH-110, ARCH-111, OVR-004, CON-113, CONV-072

## Outputs

- `apps/server/src/modules/auth/`: `index.ts`, `pin.ts`, `sessions.ts`, `rate-limit.ts`, tests, `README.md`

## Do not touch

- `spec/`, except this file's Status and Completion notes, closing sections (OVR-035), Proposed ADRs, and fixes under CONV-133
- `packages/`
- Other server modules (use config's public API to save the hash)

## Design notes

- Hash with `node:crypto` `scrypt` and a random 16-byte salt; store
  `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>` in `server.pin.hash`. Compare with
  `timingSafeEqual`.
- Sessions: a random 32-byte token in an `HttpOnly`, `SameSite=Strict` cookie named
  `mythos_session` (`Secure` when HTTPS is on), held in memory with a 30-day sliding
  expiry. A restart signs everyone out; that is acceptable (OVR-004).
- Rate limit by remote address: after 5 failures in 5 minutes, refuse for 5 minutes
  with `rate_limited` and a `Retry-After` value.
- Localhost is `127.0.0.1` or `::1` as the socket's remote address, with no
  `X-Forwarded-For` header. Exempt only when `localhostExempt` is true (ARCH-111).
- Expose framework-free functions (`isRequestAllowed`, `login`, `logout`, `setPin`);
  P1-T20 wires them into Fastify. Never log a PIN or token.

## Acceptance

- [x] ARCH-110: wrong PINs are rate-limited; the right PIN creates a session that is then accepted.
- [x] ARCH-111: localhost is exempt only when configured, and never when `X-Forwarded-For` is present.
- [x] Setting the PIN to `null` removes the lock.
- [x] `pnpm check` passes.

## Completion notes

- **Done:**
  - `apps/server/src/modules/auth/`: `auth.ts`, `pin.ts`, `sessions.ts`,
    `rate-limit.ts`, `index.ts`, and `README.md`, with 34 tests in four files. The module
    imports only config's public API, uses only `node:crypto`, and has no logger.
  - `createAuth({ config, now, secureCookies })` gives P1-T20 `checkRequest`,
    `sessionState`, `login`, `logout`, and `setPin`, plus `SESSION_COOKIE_NAME` and the
    `SessionCookie` and `AuthRequest` types. The README says how to wire them into
    Fastify and how to recover a forgotten PIN.
  - Acceptance, by test:
    - ARCH-110: `the right PIN creates a session that is then accepted`, `after 5
      failures the 6th attempt is refused, even with the right PIN`, and `of 10 wrong
      attempts sent at once, at most 5 reach the hash check`;
    - ARCH-111: `each localhost form is exempt only when localhostExempt is true` and
      `localhost is never exempt with X-Forwarded-For or Forwarded`;
    - the PIN set to `null`: `ARCH-110: setting the PIN to null removes the lock`.
  - Verified, then reverted: nine mutations each fail at least one test. They ignore
    the forwarding headers, ignore `localhostExempt`, skip ending sessions on a PIN
    change, accept an empty hash, count attempts only when they fail, exempt `DELETE
    /session`, stop sessions sliding, lengthen the lockout, and save `localhostExempt` as always
    true.
  - `pnpm check` passes. The workspace has `Tests  234 passed (234)` and
    `spec/reference` `Tests  271 passed (271)`, and it ends with `Docs check passed: 834
    requirements, 25 tasks (6 done), 19 ADRs, 76 markdown files, 311 citations in code.`
- **Rulings:**
  - **Extra file** (CONV-132): `auth.ts` holds `createAuth` and the localhost and
    exempt-route rules, which fit none of the four listed files. The design notes'
    `isRequestAllowed` is `checkRequest`, because it returns the cookie to set as well
    as a yes or no.
  - **ARCH-110, spec fix** (`P1-T16: spec: ARCH-110 names the session routes CON-113
    exempts`): "all `/api` routes except the PIN check" now reads "except the session
    routes CON-113 lists (`GET` and `POST /session`)". Read alone, the old text
    exempted only the login. No behavior changes.
  - **Mike's decisions** (`P1-T16: spec: owner: …`), recorded as 01-architecture
    Decisions rows: setting, changing, or removing the PIN ends every session; when
    machine config fails to load, only localhost is let in.
  - **01-architecture Decisions:** localhost is a socket address of `127.0.0.1`,
    `::1`, or `::ffff:127.0.0.1` with no `X-Forwarded-For` and no `Forwarded` header
    (ARCH-111); the gate reads the socket address and the matched route pattern, and a
    request no route matched passes (ARCH-110, CON-113).
  - **01-architecture Trap:** a proxy on the host makes LAN requests look local.
    P1-T21 sets `xfwd: true` on Vite's dev proxy for this reason, a cross-task ruling.
  - **01-architecture Open** (a new section): an event stream already open outlives a
    logout or a PIN change until it reconnects.
  - **03-contracts Decisions:** `rate_limited` carries `details: { retryAfterSeconds }`,
    which P1-T20 copies into `Retry-After`; `SessionState.authenticated` means a live
    session; `POST /session` with no PIN set returns 204 and no cookie.
  - **A config that failed to load**, beyond the gate (Mike's decision 2): `login`
    returns `ok(null)` for localhost, as with no PIN, and `auth_required` for any other
    device; `sessionState` says `pinRequired` for every device but localhost; `setPin`
    returns config's `validation_failed`.
  - **The cookie's lifetime slides with the session:** `checkRequest` returns a fresh
    30-day cookie each time a session lets a request in. `GET /session` returns no
    cookie, so `sessionState` checks the session with `isLive`, which does not slide
    it; the store has `isLive` beside the planned `touch`.
  - **`Secure` comes from the running server:** `secureCookies`, which P1-T20 sets from
    the HTTPS it started with, not `server.https`, which applies only after a restart
    (PRV-004).
  - **The scrypt parameters:** N = 2^14, r = 8, p = 1, a 16-byte salt, and a 32-byte
    key, about 16 MiB and some tens of milliseconds. A stored hash carries its own
    parameters. `verifyPin` accepts N a power of two up to 2^15, r up to 8, p up to 4,
    and a salt and hash of 16 to 64 bytes, with `maxmem` at 64 MiB, so a hand-edited
    file cannot make scrypt throw or claim more memory. An empty hash is malformed,
    since an empty key would equal it.
  - **Time is `now: () => number`**, not CONV-061's `Clock`, because the glossary's
    Clock is the progress tracker.
  - **Tokens and salts come from `crypto.randomBytes`**, not the dice `Rng`, which is
    seedable so rolls can be replayed (CONV-062).
  - **The rate limit:** an attempt counts when it starts, before the async hash check.
    The fifth failure in 5 minutes locks the address for 5 minutes, and so does a sixth
    attempt while five are still being checked. A success clears the address. Idle
    addresses are pruned on every call, and expired sessions on every login.
  - **`setPin` reads the config again after hashing**, so a settings save made during
    the hash is not undone.
- **Pending decisions:** None.
- **Not tested:** None. Every behavioral requirement has a test named by its ID; OVR-004
  and CONV-072 also have tests, and are met by the code and `pnpm check`.
- **Dependencies:** None.
