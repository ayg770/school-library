import type { Db } from '../db/open.js';
import type { AuditAction } from './audit.js';

/**
 * What each librarian has done, and what the library makes of it.
 *
 * The volunteers are children. A morning of counting shelves looks like
 * nothing afterwards — the books are back where they were, and the only
 * evidence is a number on a screen that resets with the next round. This
 * turns the audit log, which already records who did what, into something a
 * nine-year-old can see themselves in: a tally, a rank, and the distance to
 * the next one.
 *
 * It counts work rather than scans. A book counted twice in one round is one
 * book, a report is one report, and nothing here can be inflated by pressing
 * a button repeatedly — the actions it reads are only written when something
 * actually changed in the library.
 */

/** The kinds of work that count, and what they are called in Hebrew. */
export const COUNTED_ACTIONS = [
  'copy.counted',
  'loan.checked_out',
  'loan.returned',
  'copy.added',
  'report.filed',
] as const satisfies readonly AuditAction[];

export type CountedAction = (typeof COUNTED_ACTIONS)[number];

export const ACTION_LABELS: Record<CountedAction, string> = {
  'copy.counted': 'ספרים שנספרו',
  'loan.checked_out': 'השאלות',
  'loan.returned': 'החזרות',
  'copy.added': 'ספרים חדשים שנקלטו',
  'report.filed': 'אי-התאמות שדווחו',
};

export interface StaffProgress {
  readonly userPublicId: string;
  readonly username: string;
  readonly displayName: string;
  /** How many of each kind of work, all of them present even at zero. */
  readonly counts: Record<CountedAction, number>;
  readonly total: number;
  readonly rank: Rank;
  /** The next rank up, or null at the top of the ladder. */
  readonly nextRank: Rank | null;
  /** How many more actions until the next rank; 0 at the top. */
  readonly toNextRank: number;
  /** When they last did anything at all. */
  readonly lastActiveAt: string | null;
}

export interface Rank {
  readonly level: number;
  readonly title: string;
  readonly emoji: string;
  /** The total at which this rank is reached. */
  readonly from: number;
}

/**
 * The ladder.
 *
 * The first rung is deliberately close: a volunteer who counts one shelf has
 * reached something by the end of their first morning. The top is far enough
 * that it means a year of real work, because a ladder you finish in a week is
 * a ladder you stop climbing in a week.
 */
export const RANKS: readonly Rank[] = [
  { level: 1, title: 'מתחיל', emoji: '🌱', from: 0 },
  { level: 2, title: 'עוזר ספרן', emoji: '📗', from: 25 },
  { level: 3, title: 'ספרן', emoji: '📚', from: 100 },
  { level: 4, title: 'ספרן ותיק', emoji: '🏅', from: 300 },
  { level: 5, title: 'ספרן בכיר', emoji: '🎖️', from: 750 },
  { level: 6, title: 'אלוף הספרייה', emoji: '👑', from: 1500 },
];

export function rankFor(total: number): Rank {
  let reached = RANKS[0] as Rank;
  for (const rank of RANKS) if (total >= rank.from) reached = rank;
  return reached;
}

function nextRankAfter(rank: Rank): Rank | null {
  return RANKS.find((item) => item.level === rank.level + 1) ?? null;
}

const EMPTY_COUNTS = (): Record<CountedAction, number> =>
  Object.fromEntries(COUNTED_ACTIONS.map((action) => [action, 0])) as Record<
    CountedAction,
    number
  >;

/**
 * Everyone who may sign in, with what they have done.
 *
 * Active accounts only, and everyone is listed even at zero: a volunteer's
 * first morning is the one where seeing their own name matters most, and a
 * screen that only lists people who have already done something is a screen
 * that leaves out exactly them.
 */
export function listProgress(db: Db): StaffProgress[] {
  const people = db
    .prepare(
      `SELECT id, public_id, username, display_name
         FROM staff_users
        WHERE active = 1
        ORDER BY display_name`,
    )
    .all() as Array<{ id: number; public_id: string; username: string; display_name: string }>;

  const placeholders = COUNTED_ACTIONS.map(() => '?').join(', ');
  const tally = db
    .prepare(
      `SELECT user_id, action, COUNT(*) AS n, MAX(created_at) AS last_at
         FROM audit_log
        WHERE user_id IS NOT NULL AND action IN (${placeholders})
        GROUP BY user_id, action`,
    )
    .all(...COUNTED_ACTIONS) as Array<{
    user_id: number;
    action: CountedAction;
    n: number;
    last_at: string;
  }>;

  const byUser = new Map<number, { counts: Record<CountedAction, number>; lastAt: string | null }>();
  for (const row of tally) {
    const entry = byUser.get(row.user_id) ?? { counts: EMPTY_COUNTS(), lastAt: null };
    entry.counts[row.action] = row.n;
    entry.lastAt = entry.lastAt === null || row.last_at > entry.lastAt ? row.last_at : entry.lastAt;
    byUser.set(row.user_id, entry);
  }

  return people.map((person) => {
    const entry = byUser.get(person.id) ?? { counts: EMPTY_COUNTS(), lastAt: null };
    const total = COUNTED_ACTIONS.reduce((sum, action) => sum + entry.counts[action], 0);
    const rank = rankFor(total);
    const nextRank = nextRankAfter(rank);

    return {
      userPublicId: person.public_id,
      username: person.username,
      displayName: person.display_name,
      counts: entry.counts,
      total,
      rank,
      nextRank,
      toNextRank: nextRank === null ? 0 : nextRank.from - total,
      lastActiveAt: entry.lastAt,
    };
  });
}
