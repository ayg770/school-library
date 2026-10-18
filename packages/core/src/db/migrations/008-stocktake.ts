import type { Migration } from '../migrator.js';

/**
 * Counting the shelves — PRODUCT_SPEC.md §12.
 *
 * The catalogue says the library holds 2,212 copies. Nobody has yet stood in
 * front of the shelves with a scanner and confirmed it. Until someone has,
 * every number the application reports is a claim about a spreadsheet rather
 * than about the room, and the librarian who cannot find a book has no way to
 * tell "mis-shelved" from "never there".
 *
 * `book_copies.verified_at` has existed since the catalogue was built. What it
 * could not answer is which count a sighting belonged to. A copy last seen two
 * years ago is not evidence about this year's shelves, so a count has a
 * beginning and an end, and progress means "seen during this one" — which is
 * also what makes it repeatable next September rather than a one-off.
 *
 * Membership is a reference to the round and not a comparison against its
 * start time. Timestamps here are strings with millisecond resolution, and a
 * round opened in the same millisecond as a sighting cannot be ordered against
 * it. Pointing at the round says what was meant and never needs a clock.
 */
export const migration008: Migration = {
  version: 8,
  name: 'counting-the-shelves',
  sql: `
    CREATE TABLE stocktake_rounds (
      id                 INTEGER PRIMARY KEY,
      public_id          TEXT NOT NULL UNIQUE,
      name               TEXT NOT NULL,
      started_at         TEXT NOT NULL,
      finished_at        TEXT NULL,
      started_by_user_id INTEGER NULL REFERENCES staff_users (id),
      note               TEXT NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );

    -- One open round, enforced rather than assumed. The constant expression is
    -- what makes a partial unique index mean "at most one row matching this
    -- condition" — an index on the column would not, because in SQL every NULL
    -- differs from every other NULL.
    CREATE UNIQUE INDEX idx_one_open_stocktake ON stocktake_rounds ((1))
      WHERE finished_at IS NULL;

    CREATE INDEX idx_stocktake_started ON stocktake_rounds (started_at);

    -- Which count this copy was last seen in, and who was holding the scanner.
    -- Both are nullable: every copy in the library predates them, and the
    -- record that a book was on the shelf is worth keeping even after the
    -- account that recorded it is gone.
    ALTER TABLE book_copies ADD COLUMN verified_round_id INTEGER NULL
      REFERENCES stocktake_rounds (id);
    ALTER TABLE book_copies ADD COLUMN verified_by_user_id INTEGER NULL
      REFERENCES staff_users (id);

    CREATE INDEX idx_copies_verified_round ON book_copies (verified_round_id);
  `,
};
