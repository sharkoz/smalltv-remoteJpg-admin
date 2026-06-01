import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

describe('password hashing', () => {
  it('verifies a correct password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects a wrong password', () => {
    const stored = hashPassword('s3cret');
    expect(verifyPassword('wrong', stored)).toBe(false);
  });

  it('produces a different salt each time', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });

  it('rejects malformed stored values', () => {
    expect(verifyPassword('x', 'garbage')).toBe(false);
    expect(verifyPassword('x', '')).toBe(false);
  });
});
