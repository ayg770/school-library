import { afterEach, describe, expect, it, vi } from 'vitest';
import { nowIso } from '../src/domain/common.js';

/**
 * The sync decides what to send by comparing `updated_at` with `synced_at`,
 * strictly. A repeated stamp is therefore a change that never leaves this
 * computer, so the clock has to move even when the clock does not.
 */
describe('nowIso', () => {
  afterEach(() => vi.useRealTimers());

  it('never returns the same stamp twice, even on a frozen clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T10:00:00.000Z'));

    const stamps = [nowIso(), nowIso(), nowIso()];

    expect(new Set(stamps).size).toBe(3);
    expect([...stamps].sort()).toEqual(stamps);
  });

  it('does not go backwards when the clock does', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-22T10:00:00.000Z'));
    const before = nowIso();

    vi.setSystemTime(new Date('2026-10-22T09:00:00.000Z'));
    const after = nowIso();

    expect(after > before).toBe(true);
  });
});
