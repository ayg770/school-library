import type { Db } from '../db/open.js';
import { nowIso } from '../domain/common.js';
import { applyTable } from './pull.js';
import { loansToPush, pushLoans } from './push.js';
import { readSyncState, writeSyncState } from './state.js';
import { PULL_TABLES, type RemoteLibrary, type SyncProblem, type SyncReport, type TableResult } from './types.js';

/**
 * One exchange with the online library.
 *
 * Download, then decide, then upload — in that order, because the middle step
 * needs what the download brought and the upload needs to report what the
 * middle step decided.
 */

interface PendingLoan {
  id: number;
  copy_id: number;
  title: string;
  student_name: string;
}

/**
 * Accepts the office's suggestions, where the shelf allows it.
 *
 * A checkout made from the office is a recommendation: nobody there had the
 * book in their hand. This is the moment it becomes real — unless the copy is
 * already lent out from this desk, in which case the librarian who was holding
 * the actual book wins, and the suggestion keeps waiting. That order is the
 * whole point of AD-9, and it is decided here rather than upstream because
 * only this computer knows what is on the shelf.
 */
export function confirmOfficeLoans(db: Db): {
  confirmed: number;
  stillPending: number;
  problems: SyncProblem[];
} {
  const pending = db
    .prepare(
      `SELECT l.id, l.copy_id, b.title, s.first_name || ' ' || s.last_name AS student_name
         FROM loans l
         JOIN book_copies c ON c.id = l.copy_id
         JOIN books b       ON b.id = c.book_id
         JOIN students s    ON s.id = l.student_id
        WHERE l.origin = 'office'
          AND l.confirmed_at IS NULL
          AND l.returned_at IS NULL
        ORDER BY l.checkout_at`,
    )
    .all() as PendingLoan[];

  const heldElsewhere = db.prepare(
    `SELECT 1 FROM loans
      WHERE copy_id = ? AND returned_at IS NULL AND confirmed_at IS NOT NULL`,
  );
  const confirm = db.prepare('UPDATE loans SET confirmed_at = ?, updated_at = ? WHERE id = ?');

  const problems: SyncProblem[] = [];
  let confirmed = 0;
  let stillPending = 0;

  for (const loan of pending) {
    if (heldElsewhere.get(loan.copy_id) !== undefined) {
      stillPending += 1;
      problems.push({
        what: `${loan.title} — ${loan.student_name}`,
        why: 'הספר כבר מושאל כאן למישהו אחר. ההמלצה מהמשרד ממתינה.',
      });
      continue;
    }

    const timestamp = nowIso();
    confirm.run(timestamp, timestamp, loan.id);
    confirmed += 1;
  }

  return { confirmed, stillPending, problems };
}

export async function runSync(db: Db, remote: RemoteLibrary): Promise<SyncReport> {
  const startedAt = nowIso();
  const state = readSyncState(db);
  writeSyncState(db, { lastAttemptAt: startedAt });

  const pulled: TableResult[] = [];
  const problems: SyncProblem[] = [];
  let highWater = state.lastPulledAt;

  for (const table of PULL_TABLES) {
    const rows = await remote.fetchSince(table, state.lastPulledAt);

    // One table at a time, each in its own transaction: a network failure
    // half way through leaves the tables that did arrive intact rather than
    // rolling back an hour of downloading.
    const outcome = db.transaction(() => applyTable(db, table, rows))();

    pulled.push(outcome.result);
    problems.push(...outcome.problems);
    if (outcome.highWater !== null && (highWater === null || outcome.highWater > highWater)) {
      highWater = outcome.highWater;
    }
  }

  if (highWater !== null) writeSyncState(db, { lastPulledAt: highWater });

  const decided = db.transaction(() => confirmOfficeLoans(db))();
  problems.push(...decided.problems);

  const outgoing = loansToPush(db, state.lastPushedAt);
  const push = await pushLoans(remote, outgoing);
  problems.push(...push.problems);
  if (push.highWater !== null) writeSyncState(db, { lastPushedAt: push.highWater });

  writeSyncState(db, { lastError: null });

  return {
    startedAt,
    finishedAt: nowIso(),
    pulled,
    pushed: push.sent,
    confirmed: decided.confirmed,
    stillPending: decided.stillPending,
    problems,
  };
}
