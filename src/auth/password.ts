import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt (no external dependency). Stored format is
 * `salt:hash` in hex. Comparison is constant-time.
 */

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEYLEN);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  const dk = scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return expected.length === dk.length && timingSafeEqual(expected, dk);
}
