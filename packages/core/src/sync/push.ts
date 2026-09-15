import type { Db } from '../db/open.js';
import type { RemoteLibrary, RemoteLoan, SyncProblem } from './types.js';

/**
 * Sending up what happened at the desk.
 *
 * Circulation is this computer's to write (AD-9), so nothing upstream competes
 * with it and the upload is a plain overwrite by id. What it cannot do is
 * invent the other side's ids: a loan can only be stored online if the copy
 * and the student it names are known there. A student a librarian typed in
 * here, on a computer whose job is not to decide who the students are, has no
 * counterpart yet — so that loan waits, and says so, rather than failing the
 * whole exchange.
 */

interface PushRow {
  public_id: string;
  copy_public_id: string;
  student_public_id: string;
  checkout_at: string;
  due_at: string | null;
  returned_at: string | null;
  checkout_by_public_id: string | null;
  return_by_public_id: string | null;
  renewal_count: number;
  notes: string | null;
  origin: 'library' | 'office';
  confirmed_at: string | null;
  updated_at: string;
  book_title: string;
  student_name: string;
}

/**
 * Loans changed since the last successful upload.
 *
 * An office suggestion this computer has not yet acted on is left out: it came
 * from up there, and sending it back unchanged would risk overwriting a newer
 * version of it with an older one.
 */
export function loansToPush(db: Db, since: string | null): PushRow[] {
  return db
    .prepare(
      `SELECT l.public_id,
              c.public_id  AS copy_public_id,
              s.public_id  AS student_public_id,
              l.checkout_at, l.due_at, l.returned_at,
              co.public_id AS checkout_by_public_id,
              ro.public_id AS return_by_public_id,
              l.renewal_count, l.notes, l.origin, l.confirmed_at, l.updated_at,
              b.title      AS book_title,
              s.first_name || ' ' || s.last_name AS student_name
         FROM loans l
         JOIN book_copies c ON c.id = l.copy_id
         JOIN books b       ON b.id = c.book_id
         JOIN students s    ON s.id = l.student_id
    LEFT JOIN staff_users co ON co.id = l.checkout_by_user_id
    LEFT JOIN staff_users ro ON ro.id = l.return_by_user_id
        WHERE (? IS NULL OR l.updated_at > ?)
          AND NOT (l.origin = 'office' AND l.confirmed_at IS NULL)
        ORDER BY l.updated_at`,
    )
    .all(since, since) as PushRow[];
}

function toRemote(row: PushRow): RemoteLoan {
  return {
    public_id: row.public_id,
    copy_id: row.copy_public_id,
    student_id: row.student_public_id,
    checkout_at: row.checkout_at,
    due_at: row.due_at,
    returned_at: row.returned_at,
    checkout_by: row.checkout_by_public_id,
    return_by: row.return_by_public_id,
    renewal_count: row.renewal_count,
    notes: row.notes,
    origin: row.origin,
    confirmed_at: row.confirmed_at,
    updated_at: row.updated_at,
  };
}

export interface PushOutcome {
  readonly sent: number;
  readonly problems: readonly SyncProblem[];
  /** The newest `updated_at` actually accepted upstream. */
  readonly highWater: string | null;
}

/**
 * Uploads in one request, and only if that fails, one at a time.
 *
 * The batch is what runs normally. The retry exists because a single
 * unacceptable row would otherwise reject the whole upload and take a hundred
 * good loans down with it — and because "one loan failed, here it is" is an
 * answer a librarian can act on, while "the upload failed" is not.
 */
export async function pushLoans(
  remote: RemoteLibrary,
  rows: readonly PushRow[],
): Promise<PushOutcome> {
  if (rows.length === 0) return { sent: 0, problems: [], highWater: null };

  const newest = (accepted: readonly PushRow[]): string | null =>
    accepted.reduce<string | null>(
      (latest, row) => (latest === null || row.updated_at > latest ? row.updated_at : latest),
      null,
    );

  try {
    await remote.upsertLoans(rows.map(toRemote));
    return { sent: rows.length, problems: [], highWater: newest(rows) };
  } catch {
    const problems: SyncProblem[] = [];
    const accepted: PushRow[] = [];

    for (const row of rows) {
      try {
        await remote.upsertLoans([toRemote(row)]);
        accepted.push(row);
      } catch (cause) {
        problems.push({
          what: `${row.book_title} — ${row.student_name}`,
          why: explain(cause),
        });
      }
    }

    return { sent: accepted.length, problems, highWater: newest(accepted) };
  }
}

/** Turns a database complaint into something a librarian can act on. */
function explain(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/foreign key|violates foreign key constraint/i.test(message)) {
    return 'הספר או התלמיד עדיין לא קיימים באונליין. הוסף אותם באתר הניהול והסנכרן שוב.';
  }
  if (/duplicate key|unique/i.test(message)) {
    return 'הספר כבר מושאל באונליין להשאלה אחרת.';
  }
  return message;
}
