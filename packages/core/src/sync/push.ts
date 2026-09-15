import type { Db } from '../db/open.js';
import { TABLE_SPECS, type ColumnSpec } from './tables.js';
import type { PushTable, RemoteLibrary, RemoteRow, SyncProblem } from './types.js';

/**
 * Sending up what was written here.
 *
 * Circulation, always — that is this computer's to write. And, since the
 * library asked for it, the part of the catalogue a librarian creates at the
 * desk: a box of books arrives here, with the scanner here, and a rule that
 * they must be entered from the office is a rule nobody would keep.
 *
 * What is never sent: pupils, classes and accounts. Those are the office's
 * (AD-9), and a librarian's screen does not decide who the children are.
 *
 * A row is due to go up when it has changed since it last agreed with the
 * online library — `synced_at`. That is what stops a row that came *down* from
 * being sent straight back: the online side stamps its own `updated_at` on
 * every write, so a round trip would never settle.
 */

export interface PushRow {
  readonly publicId: string;
  /** What to call it if the online library refuses it. */
  readonly label: string;
  readonly updatedAt: string;
  readonly remote: RemoteRow;
}

/** Turns one local column into the value the online library expects. */
function toRemote(db: Db, column: ColumnSpec, value: unknown): unknown {
  if (value === null || value === undefined) return null;

  switch (column.kind) {
    case 'bool':
      return value === 1;
    case 'ref': {
      const row = db
        .prepare(`SELECT public_id FROM ${column.refTable} WHERE id = ?`)
        .get(value) as { public_id: string } | undefined;
      return row?.public_id ?? null;
    }
    default:
      return value;
  }
}

/**
 * Enough of a row for a person to recognise which one was refused.
 *
 * A loan has no name of its own — it is a book and a child — so it is asked
 * for by name. Without this the report would say "שורה", which is the same as
 * saying nothing.
 */
function labelFor(db: Db, table: PushTable, row: Record<string, unknown>): string {
  if (table === 'loans') {
    const named = db
      .prepare(
        `SELECT b.title, s.first_name || ' ' || s.last_name AS student
           FROM book_copies c
           JOIN books b    ON b.id = c.book_id
           JOIN students s ON s.public_id = ?
          WHERE c.id = ?`,
      )
      .get(row.student_public_id ?? '', row.copy_id) as
      | { title: string; student: string }
      | undefined;

    if (named !== undefined) return `${named.title} — ${named.student}`;
  }

  for (const key of ['title', 'name', 'barcode']) {
    const value = row[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return 'שורה';
}

/**
 * Everything in one table that this computer has changed and not yet sent.
 *
 * A loan the office proposed and this computer has not acted on is left out:
 * it came from up there, and sending it back unchanged risks overwriting a
 * newer version of it with an older one.
 */
export function rowsToPush(db: Db, table: PushTable): PushRow[] {
  const spec = TABLE_SPECS[table];
  const pending = table === 'loans' ? "AND NOT (origin = 'office' AND confirmed_at IS NULL)" : '';

  const extra =
    table === 'loans'
      ? ', (SELECT public_id FROM students WHERE id = loans.student_id) AS student_public_id'
      : '';

  const rows = db
    .prepare(
      `SELECT *${extra} FROM ${table}
        WHERE (synced_at IS NULL OR updated_at > synced_at) ${pending}
        ORDER BY updated_at`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => {
    const remote: RemoteRow = { public_id: String(row.public_id) };
    for (const column of spec.columns) {
      remote[column.remote] = toRemote(db, column, row[column.local]);
    }
    remote.created_at = row.created_at;
    remote.updated_at = row.updated_at;

    return {
      publicId: String(row.public_id),
      label: labelFor(db, table, row),
      updatedAt: String(row.updated_at),
      remote,
    };
  });
}

export interface PushOutcome {
  readonly sent: number;
  readonly problems: readonly SyncProblem[];
  /** The rows the online library accepted, so they can be marked as agreed. */
  readonly accepted: readonly PushRow[];
}

/**
 * Uploads in one request, and only if that fails, one at a time.
 *
 * The batch is what runs normally. The retry exists because a single
 * unacceptable row would otherwise reject the whole upload and take a hundred
 * good ones down with it — and because "this book, for this reason" is an
 * answer a librarian can act on, while "the upload failed" is not.
 */
export async function pushTable(
  remote: RemoteLibrary,
  table: PushTable,
  rows: readonly PushRow[],
): Promise<PushOutcome> {
  if (rows.length === 0) return { sent: 0, problems: [], accepted: [] };

  try {
    await remote.upsert(table, rows.map((row) => row.remote));
    return { sent: rows.length, problems: [], accepted: rows };
  } catch {
    const problems: SyncProblem[] = [];
    const accepted: PushRow[] = [];

    for (const row of rows) {
      try {
        await remote.upsert(table, [row.remote]);
        accepted.push(row);
      } catch (cause) {
        problems.push({ what: row.label, why: explain(cause) });
      }
    }

    return { sent: accepted.length, problems, accepted };
  }
}

/** Records that these rows now agree with the online library. */
export function markSynced(db: Db, table: PushTable, rows: readonly PushRow[]): void {
  const mark = db.prepare(`UPDATE ${table} SET synced_at = ? WHERE public_id = ?`);
  for (const row of rows) mark.run(row.updatedAt, row.publicId);
}

/** Turns a database complaint into something a librarian can act on. */
function explain(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);

  if (/foreign key|violates foreign key constraint/i.test(message)) {
    return 'משהו שהשורה מצביעה עליו עדיין לא קיים באונליין. סנכרן שוב אחרי שיעלה.';
  }
  if (/row-level security|permission denied|insufficient/i.test(message)) {
    return 'לחשבון שאיתו המחשב מחובר אין הרשאה לשנות את זה באונליין.';
  }
  if (/duplicate key|unique/i.test(message)) {
    return 'כבר קיים באונליין רישום אחר עם אותו מזהה ייחודי.';
  }
  return message;
}
