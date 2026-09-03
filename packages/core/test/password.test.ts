import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/index.js';

describe('password hashing', () => {
  it('never stores the password itself (§21)', () => {
    const hash = hashPassword('סיסמה-חזקה-123');
    expect(hash).not.toContain('סיסמה-חזקה-123');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('accepts the correct password', () => {
    expect(verifyPassword('correct horse', hashPassword('correct horse'))).toBe(true);
  });

  it('rejects a wrong password', () => {
    expect(verifyPassword('wrong', hashPassword('correct horse'))).toBe(false);
  });

  it('produces a different hash each time for the same password', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'));
  });

  it('handles Hebrew passwords', () => {
    const hash = hashPassword('ספרנית2024');
    expect(verifyPassword('ספרנית2024', hash)).toBe(true);
    expect(verifyPassword('ספרנית2025', hash)).toBe(false);
  });

  it('returns false for a malformed stored hash rather than throwing', () => {
    for (const stored of ['', 'nonsense', 'scrypt$1$2$3', 'bcrypt$16384$8$1$c2FsdA==$aGFzaA==']) {
      expect(verifyPassword('anything', stored)).toBe(false);
    }
  });
});
