import type { Migration } from '../migrator.js';

/**
 * Phase 0 tables only.
 *
 * ARCHITECTURE.md AD-4: each phase adds its own migration, so the runner is
 * exercised against a database that already holds data — the situation it must
 * survive in production. The catalog and circulation tables specified in
 * PRODUCT_SPEC.md §7 arrive in later phases.
 */
export const migration001: Migration = {
  version: 1,
  name: 'initial-settings-and-staff',
  sql: `
    CREATE TABLE app_settings (
      key        TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE staff_users (
      id            INTEGER PRIMARY KEY,
      public_id     TEXT NOT NULL UNIQUE,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('admin', 'librarian', 'read_only')),
      active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE INDEX idx_staff_users_active ON staff_users (active);
  `,
};
