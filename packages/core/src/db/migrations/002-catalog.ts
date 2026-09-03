import type { Migration } from '../migrator.js';

/**
 * Phase 1 — the catalog.
 *
 * Two distinctions from PRODUCT_SPEC.md §6 shape this schema:
 *
 * 1. A title (`books`) and a physical item (`book_copies`) are different
 *    things. "מסילת ישרים" is one book with five copies, and each copy carries
 *    its own barcode. An ISBN identifies the edition, never the item.
 * 2. Whether a copy is on loan is derived from an unreturned loan row, added
 *    in Phase 2 — never stored as a status column here (§7).
 *
 * `categories` and `shelf_locations` gain `public_id` and timestamps that §7
 * does not list, because §9 requires every entity an API exposes to be
 * addressed by a stable public id rather than an internal row id.
 */
export const migration002: Migration = {
  version: 2,
  name: 'catalog-classes-students-books-copies',
  sql: `
    CREATE TABLE classes (
      id                INTEGER PRIMARY KEY,
      public_id         TEXT NOT NULL UNIQUE,
      external_class_id TEXT NULL,
      name              TEXT NOT NULL,
      grade             TEXT NULL,
      section           TEXT NULL,
      academic_year     TEXT NULL,
      active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    CREATE INDEX idx_classes_active ON classes (active);
    CREATE INDEX idx_classes_external ON classes (external_class_id);

    -- Names change and students move classes, so neither is an identity (§7).
    -- A student with history is deactivated, never deleted.
    CREATE TABLE students (
      id            INTEGER PRIMARY KEY,
      public_id     TEXT NOT NULL UNIQUE,
      first_name    TEXT NOT NULL,
      last_name     TEXT NOT NULL,
      class_id      INTEGER NULL REFERENCES classes (id),
      local_barcode TEXT NULL UNIQUE,
      active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      notes         TEXT NULL,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE INDEX idx_students_class ON students (class_id);
    CREATE INDEX idx_students_active ON students (active);
    CREATE INDEX idx_students_last_name ON students (last_name);

    CREATE TABLE categories (
      id         INTEGER PRIMARY KEY,
      public_id  TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      parent_id  INTEGER NULL REFERENCES categories (id),
      active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_categories_parent ON categories (parent_id);

    CREATE TABLE shelf_locations (
      id         INTEGER PRIMARY KEY,
      public_id  TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      room       TEXT NULL,
      shelf_code TEXT NULL,
      active     INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Bibliographic record. Authors are deliberately not normalised in the
    -- MVP (§7): a free-text field covers the school's catalogue without the
    -- cost of an author table nobody has asked for.
    CREATE TABLE books (
      id                  INTEGER PRIMARY KEY,
      public_id           TEXT NOT NULL UNIQUE,
      title               TEXT NOT NULL,
      subtitle            TEXT NULL,
      author_text         TEXT NULL,
      publisher           TEXT NULL,
      publication_year    TEXT NULL,
      isbn10              TEXT NULL,
      isbn13              TEXT NULL,
      language            TEXT NULL,
      category_id         INTEGER NULL REFERENCES categories (id),
      default_call_number TEXT NULL,
      notes               TEXT NULL,
      active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE INDEX idx_books_title ON books (title);
    CREATE INDEX idx_books_author ON books (author_text);
    CREATE INDEX idx_books_category ON books (category_id);
    CREATE INDEX idx_books_isbn13 ON books (isbn13);
    CREATE INDEX idx_books_active ON books (active);

    -- One physical item. The barcode is TEXT so that leading zeros survive,
    -- and unique so that two items can never answer the same scan (§7, §34).
    CREATE TABLE book_copies (
      id                INTEGER PRIMARY KEY,
      public_id         TEXT NOT NULL UNIQUE,
      book_id           INTEGER NOT NULL REFERENCES books (id),
      barcode           TEXT NOT NULL UNIQUE,
      legacy_id         TEXT NULL,
      accession_number  TEXT NULL,
      shelf_location_id INTEGER NULL REFERENCES shelf_locations (id),
      condition_status  TEXT NOT NULL DEFAULT 'normal'
                          CHECK (condition_status IN ('normal', 'damaged', 'lost', 'repair', 'withdrawn')),
      purchase_date     TEXT NULL,
      price_cents       INTEGER NULL,
      condition_note    TEXT NULL,
      verified_at       TEXT NULL,
      active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
    );

    CREATE INDEX idx_copies_book ON book_copies (book_id);
    CREATE INDEX idx_copies_shelf ON book_copies (shelf_location_id);
    CREATE INDEX idx_copies_condition ON book_copies (condition_status);
    CREATE INDEX idx_copies_verified ON book_copies (verified_at);
  `,
};
