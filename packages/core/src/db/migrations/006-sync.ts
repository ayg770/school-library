import type { Migration } from '../migrator.js';

/**
 * Phase 7 — the link to the online library.
 *
 * ARCHITECTURE.md AD-9 splits the library by who writes what: the catalogue,
 * the people and the accounts are decided in the office and live in Supabase;
 * circulation happens here, on the library computer, and must keep working
 * with the network unplugged. This migration adds the little that the two
 * sides need in order to meet.
 *
 * Three things:
 *
 * 1. `loans.origin` and `loans.confirmed_at`. A loan proposed from the office
 *    is a recommendation until this computer has seen the book. Only a
 *    confirmed loan holds a copy, so the partial unique index is narrowed to
 *    match — a suggestion made in the office can never stop a librarian
 *    lending the book that is in their hand.
 * 2. `staff_users.email`, so an account created in the office can be matched
 *    to the person who signs in here. The password is never carried across:
 *    the office decides who the staff are, this computer decides how they
 *    prove it.
 * 3. `sync_state`, a single row holding where the last exchange got to.
 *
 * Nothing here makes the network necessary. Every column is optional, and a
 * library that never connects behaves exactly as it did before.
 */
export const migration006: Migration = {
  version: 6,
  name: 'sync-with-the-online-library',
  sql: `
    ALTER TABLE loans ADD COLUMN origin TEXT NOT NULL DEFAULT 'library'
      CHECK (origin IN ('library', 'office'));

    -- Null means "proposed, not yet seen here". Rows that existed before this
    -- migration were all made on this computer, so they are confirmed by the
    -- fact of their existence.
    ALTER TABLE loans ADD COLUMN confirmed_at TEXT NULL;
    UPDATE loans SET confirmed_at = checkout_at;

    DROP INDEX idx_loans_one_active_per_copy;
    CREATE UNIQUE INDEX idx_loans_one_active_per_copy
      ON loans (copy_id) WHERE returned_at IS NULL AND confirmed_at IS NOT NULL;

    -- And at most one open suggestion per copy, so the office cannot propose
    -- the same book twice over.
    CREATE UNIQUE INDEX idx_loans_one_pending_per_copy
      ON loans (copy_id) WHERE returned_at IS NULL AND confirmed_at IS NULL;

    CREATE INDEX idx_loans_pending ON loans (created_at) WHERE confirmed_at IS NULL;

    ALTER TABLE staff_users ADD COLUMN email TEXT NULL;
    CREATE UNIQUE INDEX idx_staff_users_email ON staff_users (email) WHERE email IS NOT NULL;

    -- One row, always. The id is checked rather than assumed: a second row
    -- would mean two answers to "when did we last sync", and the wrong one
    -- would be picked silently.
    CREATE TABLE sync_state (
      id               INTEGER PRIMARY KEY CHECK (id = 1),
      connected_email  TEXT NULL,
      refresh_token    TEXT NULL,
      last_pulled_at   TEXT NULL,
      last_pushed_at   TEXT NULL,
      last_attempt_at  TEXT NULL,
      last_error       TEXT NULL,
      created_at       TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );
  `,
};
