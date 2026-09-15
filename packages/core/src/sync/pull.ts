import type { Db } from '../db/open.js';
import { nowIso } from '../domain/common.js';
import { NO_LOCAL_PASSWORD, TABLE_SPECS, type ColumnSpec } from './tables.js';
import { PUSH_TABLES, type PullTable, type RemoteRow, type SyncProblem, type TableResult } from './types.js';

/** Tables this computer may also write, and so must mark as agreed on arrival. */
const SENDS_UP = new Set<string>(PUSH_TABLES);

/**
 * Applying what the office decided.
 *
 * Every table here is owned by the office (AD-9), so a row arriving from
 * upstream wins — there is nothing to reconcile, only to copy. The two
 * complications are both about identity:
 *
 * - References arrive as the other side's ids and have to be looked up. The
 *   order in `PULL_TABLES` exists so that a row's references are already here
 *   when it lands.
 * - This computer may already hold the same real thing under a different id,
 *   because a librarian imported a spreadsheet before the two sides met. A
 *   barcode is the same barcode whichever side wrote it down, so a local row
 *   carrying one adopts the online id rather than colliding with it.
 */

interface LocalRow {
  id: number;
  public_id: string;
}

/**
 * One spelling for an instant, whoever wrote it down.
 *
 * Anything unparseable is kept exactly as it arrived rather than turned into
 * `Invalid Date`: a value nobody expected is still evidence, and discarding it
 * would lose the only clue to what went wrong.
 */
export function normaliseTimestamp(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

/** SQLite has no boolean; the wire has no 0/1. */
function toLocal(column: ColumnSpec, value: unknown, db: Db): number | string | null {
  if (value === null || value === undefined) return null;

  switch (column.kind) {
    case 'bool':
      return value === true || value === 1 ? 1 : 0;
    case 'timestamp':
      return normaliseTimestamp(String(value));
    case 'number':
      return typeof value === 'number' ? value : Number(value);
    case 'ref': {
      const row = db
        .prepare(`SELECT id FROM ${column.refTable} WHERE public_id = ?`)
        .get(String(value)) as LocalRow | undefined;
      // A reference that has not arrived yet is dropped rather than guessed.
      // The caller counts it as a problem, so it is visible rather than silent.
      return row?.id ?? null;
    }
    default:
      return String(value);
  }
}

function timestamps(row: RemoteRow): { created: string; updated: string } {
  const created =
    typeof row.created_at === 'string' ? normaliseTimestamp(row.created_at) : nowIso();
  const updated =
    typeof row.updated_at === 'string' ? normaliseTimestamp(row.updated_at) : created;
  return { created, updated };
}

/**
 * Finds the local row this one is, under whatever id it already has.
 *
 * By online id first; then, for the tables that carry one, by the number
 * printed on the physical thing.
 */
function findExisting(db: Db, table: PullTable, row: RemoteRow): LocalRow | undefined {
  const publicId = String(row.public_id);
  const byId = db.prepare(`SELECT id, public_id FROM ${table} WHERE public_id = ?`).get(publicId) as
    | LocalRow
    | undefined;
  if (byId !== undefined) return byId;

  const key = TABLE_SPECS[table].naturalKey;
  if (key === undefined) return undefined;

  const value = row[key];
  if (value === null || value === undefined || value === '') return undefined;

  return db.prepare(`SELECT id, public_id FROM ${table} WHERE ${key} = ?`).get(String(value)) as
    | LocalRow
    | undefined;
}

export interface ApplyOutcome {
  readonly result: TableResult;
  readonly problems: readonly SyncProblem[];
  /** The latest `updated_at` seen, so the next exchange can ask for less. */
  readonly highWater: string | null;
}

export function applyTable(db: Db, table: PullTable, rows: readonly RemoteRow[]): ApplyOutcome {
  const spec = TABLE_SPECS[table];
  const problems: SyncProblem[] = [];
  let added = 0;
  let updated = 0;
  let skipped = 0;
  let highWater: string | null = null;

  for (const row of rows) {
    const publicId = typeof row.public_id === 'string' ? row.public_id : null;
    if (publicId === null) {
      skipped += 1;
      problems.push({ what: `שורה ב${table}`, why: 'הגיעה בלי מזהה' });
      continue;
    }

    const { created, updated: updatedAt } = timestamps(row);
    if (highWater === null || updatedAt > highWater) highWater = updatedAt;

    // A reference that could not be resolved is worth saying out loud: the row
    // still lands, but with that link missing, and the librarian should know
    // why a book shows no category.
    const missing: string[] = [];
    const values: Record<string, number | string | null> = {};
    for (const column of spec.columns) {
      const raw = row[column.remote];
      const local = toLocal(column, raw, db);
      if (column.kind === 'ref' && raw !== null && raw !== undefined && local === null) {
        missing.push(column.local);
      }
      values[column.local] = local;
    }
    if (missing.length > 0) {
      problems.push({
        what: `${describeRow(table, row)}`,
        why: `לא נמצא הקישור: ${missing.join(', ')}`,
      });
    }

    const existing = findExisting(db, table, row);

    if (existing === undefined) {
      const columns = ['public_id', ...spec.columns.map((c) => c.local), 'created_at', 'updated_at'];
      const params: Array<number | string | null> = [
        publicId,
        ...spec.columns.map((c) => values[c.local] ?? null),
        created,
        updatedAt,
      ];

      // A row that has just arrived agrees with the online library by
      // definition, so it is not queued to be sent back.
      if (SENDS_UP.has(table)) {
        columns.push('synced_at');
        params.push(updatedAt);
      }

      // An account from the office arrives without a way to sign in. It is
      // listed, and an administrator here gives it a password.
      if (table === 'staff_users') {
        columns.push('password_hash');
        params.push(NO_LOCAL_PASSWORD);
      }

      db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
      ).run(...params);
      added += 1;
      continue;
    }

    const assignments = spec.columns.map((c) => `${c.local} = ?`);
    const params: Array<number | string | null> = spec.columns.map((c) => values[c.local] ?? null);

    // The same thing under a different id: take the online one, so from now on
    // both sides mean the same row. Everything else about it — a local
    // password, a loan already pointing at it — is untouched.
    if (existing.public_id !== publicId) {
      assignments.push('public_id = ?');
      params.push(publicId);
    }

    assignments.push('updated_at = ?');
    params.push(updatedAt);
    if (SENDS_UP.has(table)) {
      assignments.push('synced_at = ?');
      params.push(updatedAt);
    }
    params.push(existing.id);

    db.prepare(`UPDATE ${table} SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    updated += 1;
  }

  return {
    result: { table, received: rows.length, added, updated, skipped },
    problems,
    highWater,
  };
}

/** Enough of a row for a person to recognise which one went wrong. */
function describeRow(table: PullTable, row: RemoteRow): string {
  const name =
    (typeof row.title === 'string' && row.title) ||
    (typeof row.name === 'string' && row.name) ||
    (typeof row.barcode === 'string' && `ברקוד ${row.barcode}`) ||
    (typeof row.display_name === 'string' && row.display_name) ||
    (typeof row.first_name === 'string' && `${row.first_name} ${String(row.last_name ?? '')}`.trim());

  return name === false || name === '' ? `שורה ב${table}` : name;
}
