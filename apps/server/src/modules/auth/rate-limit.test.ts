import { type AppError, type Result } from '@mythos/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRateLimiter } from './rate-limit';

const MINUTE = 60 * 1000;
const phone = '192.168.1.20';

function limiterAt(start: number) {
  const time = { at: start, now: () => time.at };
  return { time, limiter: createRateLimiter(time) };
}

const RetryAfterSchema = z.object({ retryAfterSeconds: z.int() });

/** How long a refusal says to wait, parsed rather than assumed; null if not refused. */
function retryAfter(result: Result<void, AppError>): number | null {
  if (result.ok) return null;
  expect(result.error.code).toBe('rate_limited');
  return RetryAfterSchema.parse(result.error.details).retryAfterSeconds;
}

function fail(limiter: ReturnType<typeof createRateLimiter>, address: string, times: number) {
  for (let i = 0; i < times; i++) {
    expect(limiter.begin(address).ok).toBe(true);
    limiter.recordFailure(address);
  }
}

describe('createRateLimiter', () => {
  it('ARCH-110: after 5 failures the 6th attempt is refused for 5 minutes', () => {
    const { time, limiter } = limiterAt(0);
    fail(limiter, phone, 5);
    expect(retryAfter(limiter.begin(phone))).toBe(300);
    time.at = 2 * MINUTE + 500;
    expect(retryAfter(limiter.begin(phone))).toBe(180);
  });

  it('ARCH-110: the refusal lifts after 5 minutes', () => {
    const { time, limiter } = limiterAt(0);
    fail(limiter, phone, 5);
    time.at = 5 * MINUTE - 1;
    expect(limiter.begin(phone).ok).toBe(false);
    time.at = 5 * MINUTE;
    expect(limiter.begin(phone).ok).toBe(true);
  });

  it("ARCH-110: failures older than 5 minutes don't count", () => {
    const { time, limiter } = limiterAt(0);
    fail(limiter, phone, 4);
    time.at = 5 * MINUTE;
    fail(limiter, phone, 4);
    expect(limiter.begin(phone).ok).toBe(true);
  });

  it('ARCH-110: of 10 attempts begun at once, only 5 go ahead', () => {
    const { limiter } = limiterAt(0);
    const results = Array.from({ length: 10 }, () => limiter.begin(phone));
    expect(results.filter((result) => result.ok)).toHaveLength(5);
    expect(results.slice(5).map(retryAfter)).toEqual([300, 300, 300, 300, 300]);
  });

  it('ARCH-110: a success clears the address', () => {
    const { limiter } = limiterAt(0);
    fail(limiter, phone, 4);
    expect(limiter.begin(phone).ok).toBe(true);
    limiter.recordSuccess(phone);
    fail(limiter, phone, 4);
    expect(limiter.begin(phone).ok).toBe(true);
  });

  it('ARCH-110: each address is limited on its own', () => {
    const { limiter } = limiterAt(0);
    fail(limiter, phone, 5);
    expect(limiter.begin(phone).ok).toBe(false);
    expect(limiter.begin('192.168.1.21').ok).toBe(true);
  });
});
