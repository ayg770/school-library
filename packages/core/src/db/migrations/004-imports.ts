import type { Migration } from '../migrator.js';

/**
 * Phase 4 — the import staging area.
 *
 * PRODUCT_SPEC.md §13: a file is never applied straight to the catalogue.
 * Every row lands here first, keeping both what the file said (`raw_data_json`)
 * and what it was understood to mean (`normalized_data_json`), so problems are
 * shown and decided on before anything is committed — and so a completed import
 * can be explained afterwards.
 */
export const migration004: Migration = {
  version: 4,
  name: 'import-batches-and-rows',
  sql: `
    CREATE TABLE import_batches (
      id            INTEGER PRIMARY KEY,
      public_id     TEXT NOT NULL UNIQUE,
      filename      TEXT NOT NULL,
      import_type   TEXT NOT NULL CHECK (import_type IN ('students', 'books')),
      status        TEXT NOT NULL DEFAULT 'parsed'
                      CHECK (status IN ('parsed', 'validated', 'committed', 'cancelled')),
      mapping_json  TEXT NULL,
      started_at    TEXT NOT NULL,
      finished_at   TEXT NULL,
      total_rows    INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      error_count   INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE INDEX idx_import_batches_status ON import_batches (status);

    CREATE TABLE import_rows (
      id                   INTEGER PRIMARY KEY,
      batch_id             INTEGER NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
      row_number           INTEGER NOT NULL,
      raw_data_json        TEXT NOT NULL,
      normalized_data_json TEXT NULL,
      status               TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'ready', 'warning', 'error', 'skipped', 'imported', 'failed')),
      error_json           TEXT NULL,
      created_entity_id    TEXT NULL
    );

    CREATE INDEX idx_import_rows_batch ON import_rows (batch_id, row_number);
    CREATE INDEX idx_import_rows_status ON import_rows (batch_id, status);
  `,
};
