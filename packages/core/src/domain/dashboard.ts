import type { Db } from '../db/open.js';
import { nowIso } from './common.js';

/**
 * The numbers the home screen leads with.
 *
 * Counted in one place so the tiles, the reports that follow in Phase 6, and
 * anything else that shows "how many are out" cannot disagree. Every figure is
 * derived — nothing here is a stored counter that could drift (§7).
 */
export interface DashboardSummary {
  readonly activeLoans: number;
  readonly overdue: number;
  readonly returnedToday: number;
  readonly checkedOutToday: number;
  readonly titles: number;
  readonly copies: number;
  readonly copiesOnShelf: number;
  readonly students: number;
  readonly generatedAt: string;
}

/** Midnight this morning, in the library's own timezone. */
function startOfToday(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

export function getDashboardSummary(db: Db): DashboardSummary {
  const now = nowIso();
  const since = startOfToday();

  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  const activeLoans = count('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL');
  const copies = count('SELECT COUNT(*) AS n FROM book_copies WHERE active = 1');

  return {
    activeLoans,
    overdue: count(
      'SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL AND due_at IS NOT NULL AND due_at < ?',
      now,
    ),
    returnedToday: count('SELECT COUNT(*) AS n FROM loans WHERE returned_at >= ?', since),
    checkedOutToday: count('SELECT COUNT(*) AS n FROM loans WHERE checkout_at >= ?', since),
    titles: count('SELECT COUNT(*) AS n FROM books WHERE active = 1'),
    copies,
    // Derived, not stored: a copy is on the shelf when no loan is open on it.
    copiesOnShelf: copies - activeLoans,
    students: count('SELECT COUNT(*) AS n FROM students WHERE active = 1'),
    generatedAt: now,
  };
}
