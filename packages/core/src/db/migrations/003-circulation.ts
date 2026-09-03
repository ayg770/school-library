import type { Migration } from '../migrator.js';

/**
 * Phase 2 — circulation.
 *
 * The rule that matters most is enforced by the database rather than by
 * application code: a partial unique index over `copy_id` where `returned_at`
 * is null means one physical copy can have at most one open loan. Two
 * librarians scanning the same book at the same moment cannot both succeed,
 * whatever the application does (§7).
 *
 * There is no `is_on_loan` column. Loan state is derived from the absence of a
 * return, so it cannot drift out of step with the loans themselves (§7, §34).
 */
export const migration003: Migration = {
  version: 3,
  name: 'circulation-loans-and-audit',
  sql: `
    CREATE TABLE loans (
      id                  INTEGER PRIMARY KEY,
      public_id           TEXT NOT NULL UNIQUE,
      copy_id             INTEGER NOT NULL REFERENCES book_copies (id),
      student_id          INTEGER NOT NULL REFERENCES students (id),
      checkout_at         TEXT NOT NULL,
      due_at              TEXT NULL,
      returned_at         TEXT NULL,
      checkout_by_user_id INTEGER NULL REFERENCES staff_users (id),
      return_by_user_id   INTEGER NULL REFERENCES staff_users (id),
      renewal_count       INTEGER NOT NULL DEFAULT 0 CHECK (renewal_count >= 0),
      notes               TEXT NULL,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    -- One open loan per copy. The database is the guarantee, not the code.
    CREATE UNIQUE INDEX idx_loans_one_active_per_copy
      ON loans (copy_id) WHERE returned_at IS NULL;

    CREATE INDEX idx_loans_student ON loans (student_id);
    CREATE INDEX idx_loans_copy ON loans (copy_id);
    CREATE INDEX idx_loans_checkout_at ON loans (checkout_at);
    -- Overdue reports only ever look at open loans, so the index does too.
    CREATE INDEX idx_loans_due_open ON loans (due_at) WHERE returned_at IS NULL;

    CREATE TABLE audit_log (
      id             INTEGER PRIMARY KEY,
      event_id       TEXT NOT NULL UNIQUE,
      user_id        INTEGER NULL REFERENCES staff_users (id),
      action         TEXT NOT NULL,
      entity_type    TEXT NOT NULL,
      entity_id      TEXT NULL,
      old_data_json  TEXT NULL,
      new_data_json  TEXT NULL,
      created_at     TEXT NOT NULL
    );

    CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);
    CREATE INDEX idx_audit_created ON audit_log (created_at);
    CREATE INDEX idx_audit_action ON audit_log (action);
  `,
};
