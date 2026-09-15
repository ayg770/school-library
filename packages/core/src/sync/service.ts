import type { Db } from '../db/open.js';
import { DomainError } from '../domain/errors.js';
import { runSync } from './run.js';
import { disconnect, readSyncState, writeSyncState, type SyncState } from './state.js';
import { connectWithPassword, connectWithToken, SyncAuthError } from './supabase.js';
import type { SyncReport } from './types.js';

/**
 * What the rest of the application asks of the sync.
 *
 * Deliberately small: connect, disconnect, exchange, and say where things
 * stand. Everything else — the order of the tables, the rules about
 * suggestions — is below this line and does not need to be understood in order
 * to press the button.
 */

export interface SyncStatus extends SyncState {
  readonly connected: boolean;
  /** Loans this computer has not yet managed to send up. */
  readonly waitingToSend: number;
  /** Suggestions from the office still waiting for the book to come back. */
  readonly waitingSuggestions: number;
  /** Accounts that arrived from the office and cannot sign in here yet. */
  readonly accountsWithoutPassword: number;
}

export function syncStatus(db: Db): SyncStatus {
  const state = readSyncState(db);

  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  return {
    ...state,
    connected: state.refreshToken !== null,
    waitingToSend: count(
      `SELECT COUNT(*) AS n FROM loans
        WHERE (? IS NULL OR updated_at > ?)
          AND NOT (origin = 'office' AND confirmed_at IS NULL)`,
      state.lastPushedAt,
      state.lastPushedAt,
    ),
    waitingSuggestions: count(
      `SELECT COUNT(*) AS n FROM loans
        WHERE origin = 'office' AND confirmed_at IS NULL AND returned_at IS NULL`,
    ),
    accountsWithoutPassword: count(
      "SELECT COUNT(*) AS n FROM staff_users WHERE password_hash = 'no-local-password' AND active = 1",
    ),
  };
}

/**
 * Connects this computer to the online library, once.
 *
 * The password is used to obtain a token and is then gone: what is kept is the
 * refresh token, which Supabase replaces on every use and which an
 * administrator can revoke from the office without changing anyone's password.
 */
export async function connectSync(db: Db, email: unknown, password: unknown): Promise<SyncStatus> {
  if (typeof email !== 'string' || email.trim() === '') {
    throw new DomainError('VALIDATION', 'כתובת דוא״ל היא שדה חובה.', 'email');
  }
  if (typeof password !== 'string' || password === '') {
    throw new DomainError('VALIDATION', 'סיסמה היא שדה חובה.', 'password');
  }

  try {
    const connection = await connectWithPassword(email.trim(), password);
    writeSyncState(db, {
      connectedEmail: connection.email,
      refreshToken: connection.refreshToken,
      lastError: null,
    });
  } catch (cause) {
    throw asDomainError(cause);
  }

  return syncStatus(db);
}

export function disconnectSync(db: Db): SyncStatus {
  disconnect(db);
  return syncStatus(db);
}

/**
 * One exchange, start to finish.
 *
 * A failure is recorded before it is thrown, so the sync screen can say what
 * went wrong last time even after the message that reported it has gone.
 */
export async function synchronise(db: Db): Promise<SyncReport> {
  const state = readSyncState(db);
  if (state.refreshToken === null) {
    throw new DomainError('VALIDATION', 'המחשב עדיין לא מחובר לאונליין.');
  }

  try {
    const connection = await connectWithToken(state.refreshToken);
    // Stored before the exchange rather than after: Supabase has already
    // invalidated the old token by now, and a crash half way through would
    // otherwise leave this computer holding a token that no longer works.
    writeSyncState(db, { refreshToken: connection.refreshToken, connectedEmail: connection.email });

    return await runSync(db, connection.remote);
  } catch (cause) {
    const error = asDomainError(cause);
    writeSyncState(db, { lastError: error.message });
    throw error;
  }
}

function asDomainError(cause: unknown): DomainError {
  if (cause instanceof DomainError) return cause;
  if (cause instanceof SyncAuthError) return new DomainError('VALIDATION', cause.message);
  const message = cause instanceof Error ? cause.message : 'הסנכרון נכשל.';
  return new DomainError('VALIDATION', message);
}
