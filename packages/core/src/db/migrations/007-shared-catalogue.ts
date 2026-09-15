import type { Migration } from '../migrator.js';

/**
 * Phase 7b — the catalogue is written from both sides, and a category can set
 * how long its books go out for.
 *
 * Two changes, both asked for by the library after it saw the first sync:
 *
 * 1. **A librarian may catalogue a book.** Books arrive at the library, in a
 *    box, with a scanner on the desk — insisting they be entered from the
 *    office was a rule nobody would have kept. So the catalogue now has two
 *    writers, and what is written here has to go up.
 *
 *    `synced_at` is how each row knows whether it has. It holds the
 *    `updated_at` the row had when it last agreed with the online library:
 *    equal means untouched since, null means it was born here, and anything
 *    else means there is something to send. Without it, a row that came down
 *    would be sent straight back up — and since the online side stamps its own
 *    `updated_at` on every write, the two sides would hand the same row back
 *    and forth for ever.
 *
 * 2. **A category may set its own loan period.** Textbooks are lent for the
 *    school year, not a fortnight, and a librarian should not have to remember
 *    that at the desk — nor should a child's textbook turn red in the overdue
 *    report in October. Null keeps the library-wide default.
 */
export const migration007: Migration = {
  version: 7,
  name: 'shared-catalogue-and-category-loan-period',
  sql: `
    ALTER TABLE categories       ADD COLUMN synced_at TEXT NULL;
    ALTER TABLE shelf_locations  ADD COLUMN synced_at TEXT NULL;
    ALTER TABLE books            ADD COLUMN synced_at TEXT NULL;
    ALTER TABLE book_copies      ADD COLUMN synced_at TEXT NULL;
    ALTER TABLE loans            ADD COLUMN synced_at TEXT NULL;

    CREATE INDEX idx_categories_unsent      ON categories      (updated_at) WHERE synced_at IS NULL;
    CREATE INDEX idx_shelf_locations_unsent ON shelf_locations (updated_at) WHERE synced_at IS NULL;
    CREATE INDEX idx_books_unsent           ON books           (updated_at) WHERE synced_at IS NULL;
    CREATE INDEX idx_book_copies_unsent     ON book_copies     (updated_at) WHERE synced_at IS NULL;
    CREATE INDEX idx_loans_unsent           ON loans           (updated_at) WHERE synced_at IS NULL;

    -- Null means "as long as this library lends anything". A number here wins
    -- for every book in the category.
    ALTER TABLE categories ADD COLUMN loan_days INTEGER NULL
      CHECK (loan_days IS NULL OR loan_days > 0);
  `,
};
