# P1-T16: Auth module: PIN and sessions

| | |
|---|---|
| **Phase** | 1 |
| **Status** | Not started |
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

- [ ] ARCH-110: wrong PINs are rate-limited; the right PIN creates a session that is then accepted.
- [ ] ARCH-111: localhost is exempt only when configured, and never when `X-Forwarded-For` is present.
- [ ] Setting the PIN to `null` removes the lock.
- [ ] `pnpm check` passes.

## Completion notes

_Written when the task is done (CONV-135). Replace this line and fill in each part;
a part with nothing in it says "None"._

- **Done:**
- **Rulings:**
- **Pending decisions:**
- **Not tested:**
- **Dependencies:**
