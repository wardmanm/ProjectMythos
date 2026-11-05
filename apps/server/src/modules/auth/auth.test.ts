import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type AppError, MachineConfigSchema, type Result } from '@mythos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MACHINE_CONFIG_FILE, openConfig } from '../config';
import { type Auth, type AuthRequest, createAuth } from './auth';
import type { SessionCookie } from './sessions';

const PIN = '48213579';
const PHONE = '192.168.1.20';
const LOCALHOSTS = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Setup = { pin?: string; localhostExempt?: boolean; secureCookies?: boolean; file?: string };

/** An auth over a real config in a temp folder, with the PIN set through `setPin`. */
async function setup(options: Setup = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mythos-auth-'));
  tempDirs.push(dir);
  if (options.file !== undefined) writeFileSync(path.join(dir, MACHINE_CONFIG_FILE), options.file);
  const { store } = await openConfig({
    dataDirFlag: dir,
    platform: process.platform,
    env: {},
    homedir: dir,
    cwd: dir,
  });
  const clock = { at: 0 };
  const secureCookies = options.secureCookies ?? false;
  const auth = createAuth({ config: store, now: () => clock.at, secureCookies });
  if (options.pin !== undefined) {
    const localhostExempt = options.localhostExempt ?? true;
    expect((await auth.setPin({ pin: options.pin, localhostExempt })).ok).toBe(true);
  }
  return { auth, clock, store };
}

function request(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    method: 'GET',
    routeUrl: '/api/campaigns',
    remoteAddress: PHONE,
    headers: {},
    sessionToken: undefined,
    ...overrides,
  };
}

const withToken = (sessionToken: string) => request({ sessionToken });
const loginRequest = (remoteAddress = PHONE) =>
  request({ method: 'POST', routeUrl: '/api/session', remoteAddress });

/** What the gate says: `pass` with nothing to set, `session` with a cookie, or the code. */
function gate(auth: Auth, overrides: Partial<AuthRequest> = {}): string {
  const result = auth.checkRequest(request(overrides));
  if (!result.ok) return result.error.code;
  return result.value === null ? 'pass' : 'session';
}

function codeOf(result: Result<unknown, AppError>): string {
  return result.ok ? 'ok' : result.error.code;
}

/** Logs in from the phone and returns the session cookie. */
async function logIn(auth: Auth, pin = PIN): Promise<SessionCookie> {
  const result = await auth.login(loginRequest(), { pin });
  if (!result.ok || result.value === null) throw new Error('the login did not start a session');
  return result.value;
}

function savedPin(configPath: string) {
  return MachineConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8'))).server.pin;
}

describe('createAuth: the PIN and sessions', () => {
  it('ARCH-110: the right PIN creates a session that is then accepted', async () => {
    const { auth } = await setup({ pin: PIN });
    expect(gate(auth)).toBe('auth_required');
    const token = (await logIn(auth)).value;
    const checked = auth.checkRequest(withToken(token));
    expect(checked.ok && checked.value).toMatchObject({ name: 'mythos_session', value: token });
    expect(auth.sessionState(withToken(token))).toEqual({ pinRequired: true, authenticated: true });
  });

  it('ARCH-110: a wrong PIN is auth_failed and starts no session', async () => {
    const { auth } = await setup({ pin: PIN });
    expect(codeOf(await auth.login(loginRequest(), { pin: '48213578' }))).toBe('auth_failed');
    expect(gate(auth, { sessionToken: 'made-up' })).toBe('auth_required');
  });

  it('ARCH-110: after 5 failures the 6th attempt is refused, even with the right PIN', async () => {
    const { auth, clock } = await setup({ pin: PIN });
    for (let i = 0; i < 5; i++) await auth.login(loginRequest(), { pin: '0000' });
    const refused = await auth.login(loginRequest(), { pin: PIN });
    expect(codeOf(refused)).toBe('rate_limited');
    const details = refused.ok ? null : refused.error.details;
    expect(z.object({ retryAfterSeconds: z.int() }).parse(details).retryAfterSeconds).toBe(300);
    expect(codeOf(await auth.login(loginRequest('192.168.1.21'), { pin: PIN }))).toBe('ok');
    clock.at = 5 * MINUTE;
    expect(codeOf(await auth.login(loginRequest(), { pin: PIN }))).toBe('ok');
  });

  it('ARCH-110: of 10 wrong attempts sent at once, at most 5 reach the hash check', async () => {
    const { auth } = await setup({ pin: PIN });
    const attempts = Array.from({ length: 10 }, () => auth.login(loginRequest(), { pin: '0000' }));
    const codes = (await Promise.all(attempts)).map(codeOf);
    expect(codes.filter((code) => code === 'auth_failed')).toHaveLength(5);
    expect(codes.filter((code) => code === 'rate_limited')).toHaveLength(5);
  });

  it('ARCH-110: a session expires after 30 idle days, and slides with use', async () => {
    const { auth, clock } = await setup({ pin: PIN });
    const sessionToken = (await logIn(auth)).value;
    clock.at = 29 * DAY;
    expect(gate(auth, { sessionToken })).toBe('session');
    clock.at = 58 * DAY;
    expect(gate(auth, { sessionToken })).toBe('session');
    clock.at = 88 * DAY;
    expect(gate(auth, { sessionToken })).toBe('auth_required');
    expect(auth.sessionState(withToken(sessionToken)).authenticated).toBe(false);
  });

  it('ARCH-110: logout ends the session and clears the cookie', async () => {
    const { auth } = await setup({ pin: PIN });
    const sessionToken = (await logIn(auth)).value;
    const cleared = auth.logout(sessionToken);
    expect(cleared).toMatchObject({ name: 'mythos_session', value: '' });
    expect(cleared.options.maxAge).toBe(0);
    expect(gate(auth, { sessionToken })).toBe('auth_required');
  });

  it('ARCH-110: the PIN is saved hashed, and its exemption with it', async () => {
    const { store } = await setup({ pin: PIN, localhostExempt: false });
    expect(readFileSync(store.configPath, 'utf8')).not.toContain(PIN);
    const saved = savedPin(store.configPath);
    expect(saved?.hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(saved?.localhostExempt).toBe(false);
  });

  it('ARCH-110: setting the PIN to null removes the lock', async () => {
    const { auth, store } = await setup({ pin: PIN });
    expect((await auth.setPin({ pin: null, localhostExempt: true })).ok).toBe(true);
    expect(savedPin(store.configPath)).toBeNull();
    expect(gate(auth)).toBe('pass');
    expect(auth.sessionState(request()).pinRequired).toBe(false);
  });

  it('ARCH-110: changing the PIN ends every session', async () => {
    const { auth } = await setup({ pin: PIN });
    const tokens = [(await logIn(auth)).value, (await logIn(auth)).value];
    expect((await auth.setPin({ pin: '1357', localhostExempt: true })).ok).toBe(true);
    expect(tokens.map((sessionToken) => gate(auth, { sessionToken }))).toEqual([
      'auth_required',
      'auth_required',
    ]);
    expect(codeOf(await auth.login(loginRequest(), { pin: PIN }))).toBe('auth_failed');
    expect(codeOf(await auth.login(loginRequest(), { pin: '1357' }))).toBe('ok');
  });

  it('ARCH-110: the cookie is Secure only when the running server uses HTTPS', async () => {
    const plain = await setup({ pin: PIN });
    expect((await logIn(plain.auth)).options.secure).toBe(false);
    const https = await setup({ pin: PIN, secureCookies: true });
    expect((await logIn(https.auth)).options.secure).toBe(true);
    expect(https.auth.logout(undefined).options.secure).toBe(true);
  });
});

describe('createAuth: localhost', () => {
  it('ARCH-111: each localhost form is exempt only when localhostExempt is true', async () => {
    const exempt = await setup({ pin: PIN, localhostExempt: true });
    const locked = await setup({ pin: PIN, localhostExempt: false });
    for (const remoteAddress of LOCALHOSTS) {
      expect(gate(exempt.auth, { remoteAddress }), remoteAddress).toBe('pass');
      expect(gate(locked.auth, { remoteAddress }), remoteAddress).toBe('auth_required');
    }
  });

  it('ARCH-111: localhost is never exempt with X-Forwarded-For or Forwarded', async () => {
    const { auth } = await setup({ pin: PIN, localhostExempt: true });
    const forwarded = [
      { 'x-forwarded-for': '192.168.1.20' },
      { forwarded: 'for=192.168.1.20' },
      { 'X-Forwarded-For': '192.168.1.20' },
      { 'x-forwarded-for': '' },
      { 'x-forwarded-for': ['192.168.1.20', '10.0.0.1'] },
    ];
    for (const remoteAddress of LOCALHOSTS) {
      for (const headers of forwarded) {
        expect(gate(auth, { remoteAddress, headers })).toBe('auth_required');
      }
    }
  });

  it('ARCH-111: a LAN address is never exempt', async () => {
    const { auth } = await setup({ pin: PIN, localhostExempt: true });
    for (const remoteAddress of [PHONE, '::ffff:192.168.1.20', 'fe80::1', '127.0.0.2', undefined]) {
      expect(gate(auth, { remoteAddress }), remoteAddress).toBe('auth_required');
    }
  });

  it('ARCH-111: session state shows pinRequired false for an exempt localhost', async () => {
    const exempt = await setup({ pin: PIN, localhostExempt: true });
    const locked = await setup({ pin: PIN, localhostExempt: false });
    const local = request({ remoteAddress: '::1' });
    expect(exempt.auth.sessionState(local)).toEqual({ pinRequired: false, authenticated: false });
    expect(exempt.auth.sessionState(request()).pinRequired).toBe(true);
    expect(locked.auth.sessionState(local).pinRequired).toBe(true);
  });

  it('ARCH-111: when config failed to load, LAN is refused and localhost is allowed', async () => {
    const { auth } = await setup({ file: '{ "schemaVersion": 2 }' });
    const local = request({ remoteAddress: '127.0.0.1' });
    expect(gate(auth)).toBe('auth_required');
    expect(gate(auth, { remoteAddress: '127.0.0.1' })).toBe('pass');
    const viaProxy = { remoteAddress: '127.0.0.1', headers: { forwarded: 'for=192.168.1.20' } };
    expect(gate(auth, viaProxy)).toBe('auth_required');
    expect(auth.sessionState(request()).pinRequired).toBe(true);
    expect(auth.sessionState(local).pinRequired).toBe(false);
    expect(codeOf(await auth.login(loginRequest(), { pin: PIN }))).toBe('auth_required');
    const setPin = await auth.setPin({ pin: PIN, localhostExempt: true });
    expect(codeOf(setPin)).toBe('validation_failed');
  });
});

describe('createAuth: which routes need a session', () => {
  const routes: [method: string, routeUrl: string | undefined][] = [
    ['GET', '/api/session'],
    ['POST', '/api/session'],
    ['DELETE', '/api/session'],
    ['PUT', '/api/settings/pin'],
    ['GET', '/api/settings'],
    ['GET', '/api/campaigns/:campaignId/events'],
    ['POST', '/api/campaigns'],
    ['GET', '/'],
    ['GET', '/*'],
    ['GET', '/apiary'],
    ['GET', undefined],
  ];
  const named = ([method, routeUrl]: (typeof routes)[number]) => `${method} ${String(routeUrl)}`;
  const passing = (auth: Auth) =>
    routes.filter(([method, routeUrl]) => gate(auth, { method, routeUrl }) === 'pass').map(named);

  it('CON-113: with a PIN set and no session, only the session check and the client pass', async () => {
    const { auth } = await setup({ pin: PIN });
    expect(passing(auth)).toEqual([
      'GET /api/session',
      'POST /api/session',
      'GET /',
      'GET /*',
      'GET /apiary',
      'GET undefined',
    ]);
  });

  it('OVR-004, ARCH-110: with no PIN set, every route passes and login sets no cookie', async () => {
    const { auth } = await setup();
    expect(passing(auth)).toEqual(routes.map(named));
    expect(auth.sessionState(request())).toEqual({ pinRequired: false, authenticated: false });
    expect(await auth.login(loginRequest(), { pin: PIN })).toEqual({ ok: true, value: null });
  });
});

describe('createAuth: secrets', () => {
  it('CONV-072: no error or session state contains the PIN or a token', async () => {
    const { auth } = await setup({ pin: PIN });
    const token = (await logIn(auth)).value;
    const broken = await setup({ file: 'not json' });
    const results = [
      auth.checkRequest(withToken(`${token}x`)),
      broken.auth.checkRequest(withToken(token)),
    ];
    for (let i = 0; i < 7; i++) {
      results.push(await auth.login(loginRequest(), { pin: i < 6 ? `${PIN}0` : PIN }));
    }
    expect(results.map(codeOf)).toEqual([
      'auth_required',
      'auth_required',
      ...Array<string>(5).fill('auth_failed'),
      'rate_limited',
      'rate_limited',
    ]);
    const said = [...results, auth.sessionState(withToken(token)), auth.logout(token)];
    for (const item of said) {
      const text = JSON.stringify(item);
      expect(text).not.toContain(PIN);
      expect(text).not.toContain(token);
    }
  });
});
