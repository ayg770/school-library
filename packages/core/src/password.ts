import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for staff accounts.
 *
 * PRODUCT_SPEC.md §21 requires hashed passwords. `scrypt` from Node's own
 * crypto module is used rather than bcrypt or argon2 so the project keeps a
 * single native dependency (better-sqlite3) — one less binary to rebuild for
 * whichever platform the library computer turns out to run
 * (ARCHITECTURE.md AD-1).
 */

const SCHEME = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELISM = 1; // p

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password.normalize('NFKC'), salt, KEY_BYTES, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });
  return [SCHEME, COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64'), derived.toString('base64')].join(
    '$',
  );
}

/** Constant-time verification. Returns false for any malformed stored hash. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [scheme, costText, blockSizeText, parallelismText, saltB64, expectedB64] = parts as [
    string, string, string, string, string, string,
  ];
  if (scheme !== SCHEME) return false;

  const cost = Number(costText);
  const blockSize = Number(blockSizeText);
  const parallelism = Number(parallelismText);
  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltB64, 'base64');
    expected = Buffer.from(expectedB64, 'base64');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: cost,
      r: blockSize,
      p: parallelism,
    });
  } catch {
    return false;
  }

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
