import { describe, expect, it } from 'vitest';
import { clearedSessionCookie, createSessionStore, sessionCookie } from './sessions';

const DAY = 24 * 60 * 60 * 1000;

function storeAt(start: number) {
  const time = { at: start, now: () => time.at };
  return { time, store: createSessionStore(time) };
}

describe('createSessionStore', () => {
  it('ARCH-110: a token is 32 random bytes in base64url, different every time', () => {
    const { store } = storeAt(0);
    const tokens = new Set(Array.from({ length: 50 }, () => store.create()));
    expect(tokens.size).toBe(50);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('ARCH-110: a session expires after 30 idle days, and slides with use', () => {
    const { time, store } = storeAt(1_000);
    const token = store.create();
    time.at += 29 * DAY;
    expect(store.touch(token)).toBe(true);
    time.at += 29 * DAY; // 58 days after it started, 29 after its last use
    expect(store.touch(token)).toBe(true);
    time.at += 30 * DAY - 1;
    expect(store.isLive(token)).toBe(true);
    time.at += 1;
    expect(store.isLive(token)).toBe(false);
    expect(store.touch(token)).toBe(false);
  });

  it('ARCH-110: checking a session without using it does not slide its expiry', () => {
    const { time, store } = storeAt(0);
    const token = store.create();
    time.at = 20 * DAY;
    expect(store.isLive(token)).toBe(true);
    time.at = 30 * DAY;
    expect(store.isLive(token)).toBe(false);
  });

  it('ARCH-110: remove ends one session, and clear ends them all', () => {
    const { store } = storeAt(0);
    const [first, second, third] = [store.create(), store.create(), store.create()];
    store.remove(first);
    expect([first, second, third].map((token) => store.isLive(token))).toEqual([false, true, true]);
    store.clear();
    expect([second, third].map((token) => store.isLive(token))).toEqual([false, false]);
  });

  it('ARCH-110: prune forgets expired sessions and keeps live ones', () => {
    const { time, store } = storeAt(0);
    const old = store.create();
    time.at = 10 * DAY;
    const recent = store.create();
    time.at = 30 * DAY;
    store.prune();
    time.at = 0; // were the old one still held, it would be live again here
    expect(store.isLive(old)).toBe(false);
    expect(store.isLive(recent)).toBe(true);
  });
});

describe('session cookies', () => {
  it('ARCH-110: the cookie is HttpOnly, SameSite=Strict, on /api, and lasts 30 days', () => {
    expect(sessionCookie('token', false)).toEqual({
      name: 'mythos_session',
      value: 'token',
      options: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/api',
        secure: false,
        maxAge: 30 * 24 * 60 * 60,
      },
    });
    expect(sessionCookie('token', true).options.secure).toBe(true);
  });

  it('ARCH-110: the cleared cookie has no value and expires at once', () => {
    const cleared = clearedSessionCookie(true);
    expect(cleared).toMatchObject({ name: 'mythos_session', value: '' });
    expect(cleared.options).toMatchObject({ path: '/api', maxAge: 0, secure: true });
  });
});
