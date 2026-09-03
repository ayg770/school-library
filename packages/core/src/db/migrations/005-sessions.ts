import type { Migration } from '../migrator.js';

/**
 * Sign-in sessions.
 *
 * Sessions live in the database rather than in memory so they survive a
 * restart — a librarian mid-shift should not be signed out because the service
 * was updated. It also means the same mechanism works unchanged when the
 * application later runs on the library computer.
 *
 * Only a hash of the token is stored. Someone who obtains a copy of the
 * database — a backup on a USB stick, say — still cannot use it to sign in.
 */
export const migration005: Migration = {
  version: 5,
  name: 'staff-sessions',
  sql: `
    CREATE TABLE staff_sessions (
      id           INTEGER PRIMARY KEY,
      token_hash   TEXT NOT NULL UNIQUE,
      user_id      INTEGER NOT NULL REFERENCES staff_users (id),
      created_at   TEXT NOT NULL,
      expires_at   TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE INDEX idx_staff_sessions_user ON staff_sessions (user_id);
    CREATE INDEX idx_staff_sessions_expiry ON staff_sessions (expires_at);
  `,
};
