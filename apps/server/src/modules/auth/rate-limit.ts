// Login attempts per remote address: after 5 failures within 5 minutes, every attempt
// is refused for 5 minutes, even one with the right PIN (ARCH-110).
import { type AppError, type Result, err, ok } from '@mythos/contracts';

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;
const LOCKOUT_MS = 5 * 60 * 1000;

// `attempts` holds when each attempt in the window started; a success clears them all.
type Entry = { attempts: number[]; lockedUntil: number | null };

export type RateLimiter = {
  /**
   * Counts an attempt from `address` as it starts, before the PIN is checked, or refuses
   * it with `rate_limited`. Counting first means guesses sent at once cannot all get
   * through while the earlier ones are still being checked.
   */
  begin(address: string): Result<void, AppError>;
  /** The attempt was a wrong PIN. The fifth in the window locks the address. */
  recordFailure(address: string): void;
  /** The attempt was the right PIN: the address starts over. */
  recordSuccess(address: string): void;
};

/** One limiter per server, built by `createAuth` (ARCH-022). Implements ARCH-110. */
export function createRateLimiter(now: () => number): RateLimiter {
  const entries = new Map<string, Entry>();

  // Forgets every address that is neither locked nor has an attempt in the window.
  function pruneIdle(at: number): void {
    for (const [address, entry] of entries) {
      const idle =
        entry.lockedUntil === null
          ? entry.attempts.every((start) => at - start >= WINDOW_MS)
          : at >= entry.lockedUntil;
      if (idle) entries.delete(address);
    }
  }

  function lock(entry: Entry, at: number): void {
    entry.lockedUntil = at + LOCKOUT_MS;
  }

  return {
    begin(address) {
      const at = now();
      pruneIdle(at);
      const entry = entries.get(address) ?? { attempts: [], lockedUntil: null };
      entries.set(address, entry);
      if (entry.lockedUntil !== null) return err(rateLimited(entry.lockedUntil - at));
      entry.attempts = entry.attempts.filter((start) => at - start < WINDOW_MS);
      if (entry.attempts.length >= MAX_ATTEMPTS) {
        // The earlier attempts are still being checked; they are as good as failures.
        lock(entry, at);
        return err(rateLimited(LOCKOUT_MS));
      }
      entry.attempts.push(at);
      return ok(undefined);
    },
    recordFailure(address) {
      const at = now();
      pruneIdle(at);
      const entry = entries.get(address);
      if (entry === undefined || entry.lockedUntil !== null) return;
      const recent = entry.attempts.filter((start) => at - start < WINDOW_MS);
      if (recent.length >= MAX_ATTEMPTS) lock(entry, at);
    },
    recordSuccess(address) {
      pruneIdle(now());
      entries.delete(address);
    },
  };
}

function rateLimited(remainingMs: number): AppError {
  const retryAfterSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.ceil(retryAfterSeconds / 60);
  return {
    code: 'rate_limited',
    message: `Too many wrong PINs. Try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`,
    details: { retryAfterSeconds },
  };
}
