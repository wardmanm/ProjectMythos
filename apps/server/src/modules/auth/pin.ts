// The PIN is stored hashed, never as itself (ARCH-110). A hash carries its own scrypt
// parameters, so they can change later without breaking a stored PIN:
//
//   scrypt$<N>$<r>$<p>$<salt base64>$<hash base64>
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

type ScryptParams = { N: number; r: number; p: number };

// What a new hash uses: about 16 MiB and a few tens of milliseconds per check.
const NEW_HASH: ScryptParams = { N: 2 ** 14, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Bounds on a hash read from the file. Someone can edit the file by hand, and a value
// outside these would make scrypt throw or claim far more memory than the PIN is worth.
const MAX_N = 2 ** 15;
const MAX_R = 8;
const MAX_P = 4;
// The salt and the hash, decoded. An empty hash would equal an empty key, so every PIN
// would match it.
const MIN_BYTES = 16;
const MAX_BYTES = 64;
// Above the most the bounds allow (about 32 MiB), and above Node's 32 MiB default.
const MAX_MEMORY = 64 * 1024 * 1024;

const PREFIX = 'scrypt';

/** Hashes a PIN with scrypt and a random 16-byte salt, in the stored format. Implements ARCH-110. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(pin, salt, NEW_HASH, KEY_BYTES);
  const { N, r, p } = NEW_HASH;
  return [PREFIX, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Whether `pin` matches a stored hash, compared in constant time. A hash that is
 * malformed, or whose parameters are out of bounds, never matches. Implements ARCH-110.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const parsed = parseHash(storedHash);
  if (parsed === null) return false;
  const key = await deriveKey(pin, parsed.salt, parsed.params, parsed.hash.length);
  return timingSafeEqual(key, parsed.hash);
}

type ParsedHash = { params: ScryptParams; salt: Buffer; hash: Buffer };

function parseHash(storedHash: string): ParsedHash | null {
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [, n, r, p, salt, hash] = parts;
  const params = { N: parseCount(n), r: parseCount(r), p: parseCount(p) };
  if (!isPowerOfTwo(params.N) || params.N > MAX_N) return null;
  if (params.r < 1 || params.r > MAX_R || params.p < 1 || params.p > MAX_P) return null;
  const saltBytes = parseBase64(salt);
  const hashBytes = parseBase64(hash);
  if (saltBytes === null || hashBytes === null) return null;
  return { params, salt: saltBytes, hash: hashBytes };
}

// A positive decimal integer without a sign or leading zeros, or 0 when it is not one.
function parseCount(text: string | undefined): number {
  return text !== undefined && /^[1-9]\d{0,6}$/.test(text) ? Number(text) : 0;
}

function isPowerOfTwo(value: number): boolean {
  return value >= 2 && (value & (value - 1)) === 0;
}

// Node's base64 decoder skips characters it does not know, so only a value that
// encodes back to itself is accepted.
function parseBase64(text: string | undefined): Buffer | null {
  if (text === undefined) return null;
  const bytes = Buffer.from(text, 'base64');
  if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return null;
  return bytes.toString('base64') === text ? bytes : null;
}

// Wrapped by hand: util.promisify(scrypt) loses the overload that takes options.
function deriveKey(
  pin: string,
  salt: Buffer,
  params: ScryptParams,
  length: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, length, { ...params, maxmem: MAX_MEMORY }, (error, key) => {
      if (error === null) resolve(key);
      else reject(error);
    });
  });
}
