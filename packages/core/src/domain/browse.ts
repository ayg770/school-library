import type { Db } from '../db/open.js';

/**
 * The catalogue seen as shelves and subjects rather than as a search box.
 *
 * PRODUCT_SPEC.md §14 and §16. A librarian looking for "the comics" or "what is
 * on shelf 3" is not searching — they are browsing, and a search box cannot be
 * browsed. It is also the fastest way to see that an import landed where it
 * should: if 400 books arrived and none of them have a category, this screen
 * says so at a glance.
 *
 * Every number is counted from the books and copies themselves. Nothing here is
 * stored, so nothing here can drift.
 */

export interface CategoryBreakdown {
  readonly publicId: string;
  readonly name: string;
  /** Distinct titles, not copies (§6). */
  readonly titles: number;
  readonly copies: number;
}

export interface ShelfBreakdown {
  readonly publicId: string;
  readonly name: string;
  readonly room: string | null;
  readonly copies: number;
  /** Copies currently out on loan, so a shelf count matches what is visible. */
  readonly onLoan: number;
}

export interface CatalogueBreakdown {
  readonly categories: CategoryBreakdown[];
  readonly shelves: ShelfBreakdown[];
  /** Titles with no category — the ones an import could not place. */
  readonly uncategorisedTitles: number;
  /** Copies not assigned to any shelf. */
  readonly unplacedCopies: number;
}

interface CategoryRow {
  public_id: string;
  name: string;
  titles: number;
  copies: number;
}

interface ShelfRow {
  public_id: string;
  name: string;
  room: string | null;
  copies: number;
  on_loan: number;
}

export function getCatalogueBreakdown(db: Db): CatalogueBreakdown {
  const categories = db
    .prepare(
      `SELECT c.public_id,
              c.name,
              COUNT(DISTINCT b.id)  AS titles,
              COUNT(bc.id)          AS copies
         FROM categories c
         LEFT JOIN books b        ON b.category_id = c.id AND b.active = 1
         LEFT JOIN book_copies bc ON bc.book_id = b.id
        WHERE c.active = 1
        GROUP BY c.id
        ORDER BY c.name`,
    )
    .all() as CategoryRow[];

  const shelves = db
    .prepare(
      `SELECT s.public_id,
              s.name,
              s.room,
              COUNT(bc.id) AS copies,
              COUNT(l.id)  AS on_loan
         FROM shelf_locations s
         LEFT JOIN book_copies bc ON bc.shelf_location_id = s.id
         LEFT JOIN loans l        ON l.copy_id = bc.id AND l.returned_at IS NULL
        WHERE s.active = 1
        GROUP BY s.id
        ORDER BY s.name`,
    )
    .all() as ShelfRow[];

  const uncategorisedTitles = (
    db
      .prepare('SELECT COUNT(*) AS n FROM books WHERE category_id IS NULL AND active = 1')
      .get() as { n: number }
  ).n;

  const unplacedCopies = (
    db.prepare('SELECT COUNT(*) AS n FROM book_copies WHERE shelf_location_id IS NULL').get() as {
      n: number;
    }
  ).n;

  return {
    categories: categories.map((row) => ({
      publicId: row.public_id,
      name: row.name,
      titles: row.titles,
      copies: row.copies,
    })),
    shelves: shelves.map((row) => ({
      publicId: row.public_id,
      name: row.name,
      room: row.room,
      copies: row.copies,
      onLoan: row.on_loan,
    })),
    uncategorisedTitles,
    unplacedCopies,
  };
}
