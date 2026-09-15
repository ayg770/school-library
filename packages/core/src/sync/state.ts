import type { Db } from '../db/open.js';
import { nowIso } from '../domain/common.js';

/**
 * Where the last exchange with the online library got to.
 *
 * Kept in its own table rather than in `app_settings`, which is a fixed list
 * of the library's preferences: a refresh token is not a preference, and
 * putting it there would have it reported as an unknown setting on every read.
 */

export interface SyncState {
  /** The account this computer signs in as, or null when never connected. */
  readonly connectedEmail: string | null;
  readonly refreshToken: string | null;
  readonly lastPulledAt: string | null;
  readonly lastPushedAt: string | null;
  readonly lastAttemptAt: string | null;
  /** The last failure, kept until an exchange succeeds. */
  readonly lastError: string | null;
}

interface StateRow {
  connected_email: string | null;
  refresh_token: string | null;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  last_attempt_at: string | null;
  last_error: string | null;
}

const EMPTY: SyncState = {
  connectedEmail: null,
  refreshToken: null,
  lastPulledAt: null,
  lastPushedAt: null,
  lastAttemptAt: null,
  lastError: null,
};

export function readSyncState(db: Db): SyncState {
  const row = db.prepare('SELECT * FROM sync_state WHERE id = 1').get() as StateRow | undefined;
  if (row === undefined) return EMPTY;

  return {
    connectedEmail: row.connected_email,
    refreshToken: row.refresh_token,
    lastPulledAt: row.last_pulled_at,
    lastPushedAt: row.last_pushed_at,
    lastAttemptAt: row.last_attempt_at,
    lastError: row.last_error,
  };
}

type Writable = Partial<{
  connectedEmail: string | null;
  refreshToken: string | null;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
}>;

const COLUMNS: Record<keyof Writable, string> = {
  connectedEmail: 'connected_email',
  refreshToken: 'refresh_token',
  lastPulledAt: 'last_pulled_at',
  lastPushedAt: 'last_pushed_at',
  lastAttemptAt: 'last_attempt_at',
  lastError: 'last_error',
};

/** Writes only the fields given; the single row is created on first use. */
export function writeSyncState(db: Db, changes: Writable): SyncState {
  const timestamp = nowIso();
  db.prepare(
    `INSERT INTO sync_state (id, created_at, updated_at) VALUES (1, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
  ).run(timestamp, timestamp);

  const assignments: string[] = [];
  const values: Array<string | null> = [];
  for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof Writable, string]>) {
    if (key in changes) {
      assignments.push(`${column} = ?`);
      values.push(changes[key] ?? null);
    }
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?');
    values.push(timestamp);
    db.prepare(`UPDATE sync_state SET ${assignments.join(', ')} WHERE id = 1`).run(...values);
  }

  return readSyncState(db);
}

/** Forgets the connection, leaving everything already downloaded in place. */
export function disconnect(db: Db): SyncState {
  return writeSyncState(db, { connectedEmail: null, refreshToken: null, lastError: null });
}
