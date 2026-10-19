import type { Migration } from '../migrator.js';

/**
 * "This is not that book" — PRODUCT_SPEC.md §12.
 *
 * The first count found a barcode whose sticker and whose catalogue entry
 * disagree. There is no way to tell from the desk whether the sticker was put
 * on the wrong book years ago or the spreadsheet was wrong when it was
 * imported, and a librarian holding a book and a queue of children is the
 * worst possible person to ask.
 *
 * So the desk does not decide. It says "this is wrong", in one press, and
 * carries on counting. The disagreements collect here, where somebody with
 * time and both records in front of them can settle them one by one.
 *
 * The copy is kept by reference and the title by value. The reference is how
 * the report is acted on; the stored title is what the catalogue claimed at
 * the moment of the report, which is the evidence — and which would otherwise
 * be destroyed by the very correction the report asks for.
 */
export const migration009: Migration = {
  version: 9,
  name: 'catalogue-disagreements',
  sql: `
    CREATE TABLE catalogue_reports (
      id                 INTEGER PRIMARY KEY,
      public_id          TEXT NOT NULL UNIQUE,
      copy_id            INTEGER NULL REFERENCES book_copies (id),
      barcode            TEXT NOT NULL,
      /** What the catalogue said this barcode was, when it was reported. */
      claimed_title      TEXT NULL,
      /** What the librarian says it actually is, when they had time to say. */
      actual_title       TEXT NULL,
      kind               TEXT NOT NULL DEFAULT 'wrong_book'
                           CHECK (kind IN ('wrong_book', 'unreadable', 'other')),
      note               TEXT NULL,
      reported_by_user_id INTEGER NULL REFERENCES staff_users (id),
      reported_at        TEXT NOT NULL,
      resolved_at        TEXT NULL,
      resolution         TEXT NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    -- One open report per barcode. Scanning a shelf twice must not file the
    -- same disagreement twice, and a librarian who presses the button again
    -- because nothing visibly happened should not be punished for it.
    CREATE UNIQUE INDEX idx_one_open_report_per_barcode
      ON catalogue_reports (barcode) WHERE resolved_at IS NULL;

    CREATE INDEX idx_reports_open ON catalogue_reports (resolved_at);
  `,
};
