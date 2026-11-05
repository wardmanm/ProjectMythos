import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from './pin';

/** A hash in the stored format, with parameters of the test's choosing. */
function handMadeHash(pin: string, N: number, r: number, p: number): string {
  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, 32, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

describe('hashPin and verifyPin', () => {
  it('ARCH-110: the hash has the scrypt format, differs per salt, and verifies only the right PIN', async () => {
    const first = await hashPin('482193');
    const second = await hashPin('482193');
    expect(first).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(first).not.toContain('482193');
    expect(second).not.toBe(first);
    expect(await verifyPin('482193', first)).toBe(true);
    expect(await verifyPin('482193', second)).toBe(true);
    expect(await verifyPin('482194', first)).toBe(false);
    expect(await verifyPin('', first)).toBe(false);
  });

  it('ARCH-110: a hash keeps its own parameters, so older ones still verify', async () => {
    const stored = handMadeHash('7731', 1024, 4, 2);
    expect(await verifyPin('7731', stored)).toBe(true);
    expect(await verifyPin('7732', stored)).toBe(false);
  });

  it('ARCH-110: a malformed hash never verifies', async () => {
    const good = handMadeHash('1234', 1024, 8, 1);
    const [, , , , salt, key] = good.split('$') as [string, string, string, string, string, string];
    const shortKey = randomBytes(8).toString('base64');
    const malformed = [
      '',
      '1234',
      'not a hash',
      `bcrypt$1024$8$1$${salt}$${key}`,
      `scrypt$1024$8$1$${salt}`,
      `scrypt$1024$8$1$${salt}$${key}$extra`,
      `scrypt$1000$8$1$${salt}$${key}`, // N is not a power of two
      `scrypt$1$8$1$${salt}$${key}`,
      `scrypt$${String(2 ** 20)}$8$1$${salt}$${key}`, // too much memory
      `scrypt$${String(2 ** 30)}$8$1$${salt}$${key}`,
      `scrypt$1024$0$1$${salt}$${key}`,
      `scrypt$1024$64$1$${salt}$${key}`,
      `scrypt$1024$8$0$${salt}$${key}`,
      `scrypt$1024$8$99$${salt}$${key}`,
      `scrypt$01024$8$1$${salt}$${key}`,
      `scrypt$-1024$8$1$${salt}$${key}`,
      `scrypt$1024.0$8$1$${salt}$${key}`,
      `scrypt$1024$8$1$$${key}`, // no salt
      `scrypt$1024$8$1$${salt}$`, // no hash: an empty key would equal it
      `scrypt$1024$8$1$${salt}$${shortKey}`,
      `scrypt$1024$8$1$${salt}$${key.slice(0, -1)}!`,
      `scrypt$1024$8$1$${salt}$ ${key}`,
    ];
    for (const stored of malformed) {
      expect(await verifyPin('1234', stored), stored).toBe(false);
    }
    expect(await verifyPin('1234', good)).toBe(true);
  });
});
