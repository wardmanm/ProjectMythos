// Sessions: a random token in a cookie, held in memory with a sliding 30-day expiry. A
// restart signs every device out, which is acceptable for a convenience lock (OVR-004).
import { randomBytes } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'mythos_session';

// A session ends after 30 days without use.
const SESSION_IDLE_SECONDS = 30 * 24 * 60 * 60;
const SESSION_IDLE_MS = SESSION_IDLE_SECONDS * 1000;
const TOKEN_BYTES = 32;

/**
 * A cookie for the http module to set, in `@fastify/cookie`'s terms. `maxAge` is in
 * seconds; 0 deletes the cookie.
 */
export type SessionCookie = {
  name: typeof SESSION_COOKIE_NAME;
  value: string;
  options: {
    httpOnly: true;
    sameSite: 'strict';
    path: '/api';
    secure: boolean;
    maxAge: number;
  };
};

/** The cookie for a live session. Its lifetime restarts each time the session is used. */
export function sessionCookie(token: string, secure: boolean): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api',
      secure,
      maxAge: SESSION_IDLE_SECONDS,
    },
  };
}

/** The cookie that makes the browser forget its session. */
export function clearedSessionCookie(secure: boolean): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: '',
    options: { httpOnly: true, sameSite: 'strict', path: '/api', secure, maxAge: 0 },
  };
}

export type SessionStore = {
  /** Starts a session and returns its token. */
  create(): string;
  /** Whether the token's session is live, without counting this as a use. */
  isLive(token: string): boolean;
  /** Whether the token's session is live; if it is, its expiry restarts. */
  touch(token: string): boolean;
  /** Ends one session. */
  remove(token: string): void;
  /** Ends every session. */
  clear(): void;
  /** Forgets sessions that have expired. */
  prune(): void;
};

/**
 * The in-memory sessions, each a token and when it expires. One store per server, built
 * by the composition root through `createAuth` (ARCH-022). Implements ARCH-110.
 */
export function createSessionStore(now: () => number): SessionStore {
  const expiresAt = new Map<string, number>();

  function isLive(token: string): boolean {
    const expiry = expiresAt.get(token);
    return expiry !== undefined && now() < expiry;
  }

  return {
    create() {
      const token = randomBytes(TOKEN_BYTES).toString('base64url');
      expiresAt.set(token, now() + SESSION_IDLE_MS);
      return token;
    },
    isLive,
    touch(token) {
      if (!isLive(token)) {
        expiresAt.delete(token);
        return false;
      }
      expiresAt.set(token, now() + SESSION_IDLE_MS);
      return true;
    },
    remove(token) {
      expiresAt.delete(token);
    },
    clear() {
      expiresAt.clear();
    },
    prune() {
      const at = now();
      for (const [token, expiry] of expiresAt) {
        if (at >= expiry) expiresAt.delete(token);
      }
    },
  };
}
