// The optional PIN lock (ARCH-110, OVR-004), as framework-free functions the http module
// wires into Fastify. Every check reads the config afresh, so a PIN change applies at
// once (PRV-004). The module has no logger, so a PIN or token can never reach a log
// (CONV-072).
import {
  type AppError,
  type MachineConfig,
  type PinLoginCommandSchema,
  type Result,
  type SessionStateSchema,
  type SetPinCommandSchema,
  type TimeSource,
  err,
  ok,
} from '@mythos/contracts';
import type { z } from 'zod';
import type { ConfigStore } from '../config';
import { hashPin, verifyPin } from './pin';
import { createRateLimiter } from './rate-limit';
import {
  type SessionCookie,
  clearedSessionCookie,
  createSessionStore,
  sessionCookie,
} from './sessions';

type PinLoginCommand = z.infer<typeof PinLoginCommandSchema>;
type SessionState = z.infer<typeof SessionStateSchema>;
type SetPinCommand = z.infer<typeof SetPinCommandSchema>;

/** What the auth module needs to know about a request. The http module builds it. */
export type AuthRequest = {
  /** Upper case, as Fastify gives it. */
  method: string;
  /** The matched route pattern (`request.routeOptions.url`); undefined when none matched. */
  routeUrl: string | undefined;
  /** The socket's address (`request.socket.remoteAddress`), never `request.ip`. */
  remoteAddress: string | undefined;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The session cookie's value, if the request sent one. */
  sessionToken: string | undefined;
};

export type AuthOptions = {
  config: Pick<ConfigStore, 'current' | 'save'>;
  /** Wall time, for session expiry and the rate limit (CONV-061). */
  timeSource: TimeSource;
  /** Whether the running server speaks HTTPS, which makes the cookie `Secure`. */
  secureCookies: boolean;
};

export type Auth = {
  checkRequest(request: AuthRequest): Result<SessionCookie | null, AppError>;
  sessionState(request: AuthRequest): SessionState;
  login(
    request: AuthRequest,
    command: PinLoginCommand,
  ): Promise<Result<SessionCookie | null, AppError>>;
  logout(sessionToken: string | undefined): SessionCookie;
  setPin(command: SetPinCommand): Promise<Result<void, AppError>>;
};

const SESSION_ROUTE = '/api/session';
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARDED_HEADERS = new Set(['x-forwarded-for', 'forwarded']);

const authRequired: AppError = {
  code: 'auth_required',
  message: 'Enter the PIN to use Mythos from this device.',
};
const configBroken: AppError = {
  code: 'auth_required',
  message:
    'Machine config failed to load, so only the computer running Mythos can use it. Fix the config there, in Settings.',
};
const authFailed: AppError = { code: 'auth_failed', message: 'That PIN is not right.' };

/**
 * The PIN lock, with its sessions and rate limiter held inside. Built once by the
 * composition root (ARCH-022). Implements ARCH-110 and ARCH-111.
 */
export function createAuth(options: AuthOptions): Auth {
  const { config, timeSource, secureCookies } = options;
  const sessions = createSessionStore(timeSource);
  const limiter = createRateLimiter(timeSource);

  /**
   * Whether a request may go ahead. `ok(cookie)` when a session let it in: the http
   * module sets the cookie so its lifetime slides with the session's. `ok(null)` when it
   * passes with nothing to set. Implements ARCH-110, ARCH-111, and CON-113.
   */
  function checkRequest(request: AuthRequest): Result<SessionCookie | null, AppError> {
    if (!isApiRoute(request.routeUrl) || isSessionCheck(request)) return ok(null);
    const state = config.current();
    if (!state.ok) return isLocalhost(request) ? ok(null) : err(configBroken);
    if (!isLocked(state.value, request)) return ok(null);
    const token = request.sessionToken;
    if (token !== undefined && sessions.touch(token)) {
      return ok(sessionCookie(token, secureCookies));
    }
    return err(authRequired);
  }

  /** What the PIN screen needs: whether this device must log in, and whether it has. */
  function sessionState(request: AuthRequest): SessionState {
    const token = request.sessionToken;
    const authenticated = token !== undefined && sessions.isLive(token);
    const state = config.current();
    const pinRequired = state.ok ? isLocked(state.value, request) : !isLocalhost(request);
    return { pinRequired, authenticated };
  }

  /**
   * Checks a PIN and starts a session. With no PIN set there is nothing to check, so it
   * passes without a cookie. Rate-limited per address. Implements ARCH-110.
   */
  async function login(
    request: AuthRequest,
    command: PinLoginCommand,
  ): Promise<Result<SessionCookie | null, AppError>> {
    const state = config.current();
    if (!state.ok) return isLocalhost(request) ? ok(null) : err(configBroken);
    const pin = state.value.server.pin;
    if (pin === null) return ok(null);

    // Counted before the first await, so attempts sent together are all counted.
    const address = request.remoteAddress ?? '';
    const started = limiter.begin(address);
    if (!started.ok) return started;
    if (!(await verifyPin(command.pin, pin.hash))) {
      limiter.recordFailure(address);
      return err(authFailed);
    }
    limiter.recordSuccess(address);
    sessions.prune();
    return ok(sessionCookie(sessions.create(), secureCookies));
  }

  /** Ends the request's session, and returns the cookie that clears it in the browser. */
  function logout(sessionToken: string | undefined): SessionCookie {
    if (sessionToken !== undefined) sessions.remove(sessionToken);
    return clearedSessionCookie(secureCookies);
  }

  /**
   * Sets, changes, or (with `pin: null`) removes the PIN, saving it hashed in machine
   * config. Any change ends every session, so a lost device is signed out at once.
   * Implements ARCH-110 and ARCH-111.
   */
  async function setPin(command: SetPinCommand): Promise<Result<void, AppError>> {
    const before = config.current();
    if (!before.ok) return err(before.error);
    const pin =
      command.pin === null
        ? null
        : { hash: await hashPin(command.pin), localhostExempt: command.localhostExempt };
    // Read again after hashing, so a save made meanwhile is not undone.
    const state = config.current();
    if (!state.ok) return err(state.error);
    const saved = await config.save({ ...state.value, server: { ...state.value.server, pin } });
    if (!saved.ok) return err(saved.error);
    sessions.clear();
    return ok(undefined);
  }

  return { checkRequest, sessionState, login, logout, setPin };
}

// Paths outside /api are the static client, and an unmatched path gets only the
// not-found handler: neither holds anything the PIN protects (CON-113).
function isApiRoute(routeUrl: string | undefined): boolean {
  return routeUrl !== undefined && (routeUrl === '/api' || routeUrl.startsWith('/api/'));
}

// Implements CON-113: the PIN screen must be able to ask whether it is needed, and log in.
function isSessionCheck(request: AuthRequest): boolean {
  return (
    request.routeUrl === SESSION_ROUTE && (request.method === 'GET' || request.method === 'POST')
  );
}

// A PIN is set, and this request is not an exempt localhost.
function isLocked(machineConfig: MachineConfig, request: AuthRequest): boolean {
  const pin = machineConfig.server.pin;
  if (pin === null) return false;
  return !(pin.localhostExempt && isLocalhost(request));
}

/**
 * Localhost is a loopback socket address with no forwarding header. A proxy on this
 * computer connects from loopback, and the header is the only sign that the request
 * started elsewhere. Implements ARCH-111.
 */
function isLocalhost(request: AuthRequest): boolean {
  if (request.remoteAddress === undefined || !LOOPBACK_ADDRESSES.has(request.remoteAddress)) {
    return false;
  }
  return !Object.keys(request.headers).some(
    (name) => FORWARDED_HEADERS.has(name.toLowerCase()) && request.headers[name] !== undefined,
  );
}
