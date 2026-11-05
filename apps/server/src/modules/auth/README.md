# auth

The optional PIN lock and its session cookie. It hashes the PIN into machine config,
checks a PIN with a per-address rate limit, keeps sessions in memory, and decides which
requests need a session. It is framework-free: the http module (P1-T20) wires it into
Fastify. It imports only the config module (ARCH-021), and it uses `node:crypto` and
nothing outside the approved list.

The lock is convenience, not security (OVR-004). A restart signs every device out.

## Public API (`index.ts`)

- `createAuth({ config, timeSource, secureCookies })` builds the lock, with its
  sessions and rate limiter inside. The composition root calls it once (ARCH-022), with
  the `ConfigStore`, the injected `TimeSource` that session expiry and the rate limit
  read wall time from (CONV-061), and whether the running server speaks HTTPS. `secureCookies` comes from how the server started, not from
  `server.https` in the config, which applies only after a restart.
- `Auth`:
  - `checkRequest(request)` returns `ok(cookie)` when a session let the request in,
    `ok(null)` when it passes with nothing to set, or `auth_required`.
  - `sessionState(request)` returns the `SessionState` for `GET /session`.
  - `login(request, command)` checks the PIN for `POST /session`. It returns
    `ok(cookie)`, `ok(null)` when no PIN is set (204 and no cookie), `auth_failed`, or
    `rate_limited` with `details: { retryAfterSeconds }`.
  - `logout(sessionToken)` ends the session for `DELETE /session` and returns the
    cookie that clears it.
  - `setPin(command)` sets, changes, or (with `pin: null`) removes the PIN for
    `PUT /settings/pin`, saving it hashed through `config.save`. Any change ends every
    session. It returns config's error if the config failed to load.
- `AuthRequest` is what the module reads from a request: `method`, `routeUrl`,
  `remoteAddress`, `headers`, and `sessionToken`.
- `SessionCookie` is `{ name, value, options }` in `@fastify/cookie`'s terms, with
  `maxAge` in seconds. `SESSION_COOKIE_NAME` is `mythos_session`.

The module has no logger, so it can never log a PIN or a token (CONV-072). Never log a
`SessionCookie`, an `AuthRequest`, or a login command either.

## Wiring it in (P1-T20)

- **Construct it** in `app.ts` with the composition root's real `TimeSource`; tests
  pass one they can move by hand.
- **The gate** is an `onRequest` hook. It builds the `AuthRequest` from:
  - `request.method`;
  - `request.routeOptions.url`, the matched route pattern, such as
    `/api/campaigns/:campaignId/events`, or undefined when no route matched;
  - `request.socket.remoteAddress`, never `request.ip`, which follows
    `trustProxy`;
  - `request.headers`;
  - `request.cookies[SESSION_COOKIE_NAME]`.

  On `ok(cookie)` it calls `reply.setCookie(cookie.name, cookie.value, cookie.options)`,
  so the browser's expiry slides with the session's. On an error it replies `401`.

- **`rate_limited`** maps to `429`, with `details.retryAfterSeconds` also sent as the
  `Retry-After` header.
- **Exempt from the PIN** (CON-113): `GET` and `POST /api/session`, every path outside
  `/api` (the static client), and a request no route matched. Everything else under
  `/api`, the event stream included, needs a session, unless no PIN is set or the
  request is from an exempt localhost.
- **Localhost** (ARCH-111) is a socket address of `127.0.0.1`, `::1`, or
  `::ffff:127.0.0.1`, with no `X-Forwarded-For` and no `Forwarded` header. It is exempt
  only when `server.pin.localhostExempt` is true. A proxy on the host must add
  `X-Forwarded-For`, or every request through it looks local.
- **When machine config failed to load**, localhost passes and every other device is
  refused, so the owner can fix the config in Settings on the host.

## A forgotten PIN

Stop the server, set `"pin": null` under `server` in `machine-config.json`, and start
it again. The file is in the folder given by `--data-dir`, or else in the OS default
(ARCH-030): `%APPDATA%\Mythos` on Windows, `~/Library/Application Support/Mythos` on
macOS.

## Files

- `auth.ts`: `createAuth`, and the localhost and exempt-route rules.
- `pin.ts`: `hashPin` and `verifyPin`. The stored format is
  `scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>`; new hashes use N = 2^14, r = 8,
  p = 1, a 16-byte salt, and a 32-byte key.
- `sessions.ts`: the in-memory sessions and the cookie.
- `rate-limit.ts`: 5 attempts per address in 5 minutes, then 5 minutes of refusals.

## Governing spec

- [01-architecture.md](../../../../../spec/01-architecture.md) §6.4: ARCH-110 and
  ARCH-111, and its Traps, Decisions, and Open sections.
- [03-contracts.md](../../../../../spec/03-contracts.md) §14: `SetPinCommand`,
  `SessionState`, `PinLoginCommand`, the session routes, and CON-113.
- [00-overview.md](../../../../../spec/00-overview.md): OVR-004.
- [02-conventions.md](../../../../../spec/02-conventions.md): CONV-072.
