// The auth module's public API (ARCH-020): the optional PIN lock and its session cookie.
// It imports only the config module (ARCH-021).
export { type Auth, type AuthOptions, type AuthRequest, createAuth } from './auth';
export { SESSION_COOKIE_NAME, type SessionCookie } from './sessions';
