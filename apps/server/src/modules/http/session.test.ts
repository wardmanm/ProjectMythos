import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema, SessionStateSchema } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { SESSION_COOKIE_NAME } from '../auth';
import { createHttpSpace, type HttpStack } from './testing';

const space = createHttpSpace();
afterEach(async () => {
  await space.cleanUp();
});

const PIN = '2468';
/** A phone on the local network. */
const PHONE = '192.168.1.20';

async function lockedStack(localhostExempt = true): Promise<HttpStack> {
  const stack = await space.stack();
  const set = await stack.auth.setPin({ pin: PIN, localhostExempt });
  if (!set.ok) throw new Error(set.error.message);
  return stack;
}

async function logIn(stack: HttpStack, pin: string) {
  return stack.server.inject({
    method: 'POST',
    url: '/api/session',
    remoteAddress: PHONE,
    payload: { pin },
  });
}

function sessionCookieOf(response: { cookies: { name: string; value: string }[] }): string {
  const cookie = response.cookies.find(({ name }) => name === SESSION_COOKIE_NAME);
  if (cookie === undefined) throw new Error('no session cookie was set');
  return cookie.value;
}

function codeOf(response: { json: () => unknown }): string {
  return ErrorResponseSchema.parse(response.json()).error.code;
}

describe('the PIN gate', () => {
  it('CON-113, ARCH-110: with a PIN and no session, only GET and POST /session pass', async () => {
    const stack = await lockedStack();
    const campaignId = randomUUID();

    const state = await stack.server.inject({ url: '/api/session', remoteAddress: PHONE });
    expect(SessionStateSchema.parse(state.json())).toEqual({
      pinRequired: true,
      authenticated: false,
    });
    // POST /session reaches the PIN check, so a wrong PIN is auth_failed, not auth_required.
    expect(codeOf(await logIn(stack, '0000'))).toBe('auth_failed');

    for (const [method, url] of [
      ['GET', '/api/packs'],
      ['GET', '/api/campaigns'],
      ['DELETE', '/api/session'],
      ['GET', `/api/campaigns/${campaignId}/events`],
      ['PUT', '/api/settings'],
      ['POST', '/api/settings/profiles/mock-narrator/probe'],
    ] as const) {
      const response = await stack.server.inject({ method, url, remoteAddress: PHONE });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(codeOf(response)).toBe('auth_required');
    }
  });

  it('ARCH-110: the right PIN sets a session cookie that opens every route, and slides', async () => {
    const stack = await lockedStack();
    const login = await logIn(stack, PIN);
    expect(login.statusCode).toBe(204);
    const token = sessionCookieOf(login);

    const packs = await stack.server.inject({
      url: '/api/packs',
      remoteAddress: PHONE,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(packs.statusCode).toBe(200);
    // The gate sends the cookie again, so the browser's expiry follows the session's.
    expect(sessionCookieOf(packs)).toBe(token);

    const state = await stack.server.inject({
      url: '/api/session',
      remoteAddress: PHONE,
      cookies: { [SESSION_COOKIE_NAME]: token },
    });
    expect(SessionStateSchema.parse(state.json()).authenticated).toBe(true);
  });

  it('ARCH-110: logging out ends the session and clears the cookie', async () => {
    const stack = await lockedStack();
    const token = sessionCookieOf(await logIn(stack, PIN));
    const cookies = { [SESSION_COOKIE_NAME]: token };

    const logout = await stack.server.inject({
      method: 'DELETE',
      url: '/api/session',
      remoteAddress: PHONE,
      cookies,
    });
    expect(logout.statusCode).toBe(204);
    expect(sessionCookieOf(logout)).toBe('');

    const after = await stack.server.inject({ url: '/api/packs', remoteAddress: PHONE, cookies });
    expect(after.statusCode).toBe(401);
  });

  it('ARCH-110: after 5 wrong PINs the next try is rate_limited, with Retry-After', async () => {
    const stack = await lockedStack();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(codeOf(await logIn(stack, '1111'))).toBe('auth_failed');
    }
    const refused = await logIn(stack, PIN);
    expect(refused.statusCode).toBe(429);
    expect(codeOf(refused)).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('CON-113: with no PIN set, every route passes and POST /session is 204 with no cookie', async () => {
    const stack = await space.stack();
    const packs = await stack.server.inject({ url: '/api/packs', remoteAddress: PHONE });
    expect(packs.statusCode).toBe(200);
    const login = await logIn(stack, PIN);
    expect(login.statusCode).toBe(204);
    expect(login.cookies).toEqual([]);
  });

  it('ARCH-111: an exempt localhost passes, but not once a forwarding header is present', async () => {
    const stack = await lockedStack(true);
    const local = await stack.server.inject({ url: '/api/packs', remoteAddress: '127.0.0.1' });
    expect(local.statusCode).toBe(200);
    const forwarded = await stack.server.inject({
      url: '/api/packs',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': PHONE },
    });
    expect(forwarded.statusCode).toBe(401);
  });

  it('ARCH-110: a login body the contract rejects is validation_failed', async () => {
    const stack = await lockedStack();
    const response = await stack.server.inject({
      method: 'POST',
      url: '/api/session',
      remoteAddress: PHONE,
      payload: { pin: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(codeOf(response)).toBe('validation_failed');
  });
});
