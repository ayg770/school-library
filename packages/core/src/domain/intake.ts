import type { Db } from '../db/open.js';
import { createBook, getBook, listBooks, type Book } from './books.js';
import { requireBarcode, requireText, optionalText } from './common.js';
import { createCopy, findCopyByBarcode, type BookCopy } from './copies.js';
import { DomainError } from './errors.js';

/**
 * Adding one physical book, in a single step.
 *
 * PRODUCT_SPEC.md §12 and §27: a librarian working through a shelf scans a
 * barcode and moves on. Making them create a title, find it again, and then
 * add a copy is three steps where the work is one — and for a few thousand
 * books that difference is the whole job.
 *
 * The title is found or created; the copy is always new. Five copies of one
 * book stay one book with five copies (§6).
 */

export interface IntakeInput {
  readonly barcode: unknown;
  readonly title: unknown;
  readonly authorText?: unknown;
  readonly isbn13?: unknown;
  readonly categoryPublicId?: unknown;
  readonly shelfPublicId?: unknown;
}

export interface IntakeResult {
  readonly copy: BookCopy;
  readonly book: Book;
  /** True when this scan created the title, false when it joined an existing one. */
  readonly createdTitle: boolean;
}

/**
 * Finds the title this copy belongs to, or creates it.
 *
 * ISBN first, then an exact title and author match — the same rule the file
 * import uses, so a book entered by hand and the same book arriving in a
 * spreadsheet land on one record rather than two.
 */
function findOrCreateBook(
  db: Db,
  values: { title: string; author: string | null; isbn: string | null; categoryPublicId: string | null },
): { book: Book; created: boolean } {
  if (values.isbn !== null) {
    const byIsbn = listBooks(db, { query: values.isbn, limit: 5 }).items.find(
      (book) => book.isbn13 === values.isbn,
    );
    if (byIsbn !== undefined) return { book: byIsbn, created: false };
  }

  const byTitle = listBooks(db, { query: values.title, limit: 50 }).items.find(
    (book) => book.title === values.title && (book.authorText ?? null) === values.author,
  );
  if (byTitle !== undefined) return { book: byTitle, created: false };

  return {
    book: createBook(db, {
      title: values.title,
      authorText: values.author,
      isbn13: values.isbn,
      categoryPublicId: values.categoryPublicId,
    }),
    created: true,
  };
}

export function intakeCopy(db: Db, input: IntakeInput): IntakeResult {
  const barcode = requireBarcode(input.barcode);

  // Checked before anything is created, so a mistaken re-scan does not leave a
  // stray title behind. The message names what the barcode already is, which
  // is what the librarian needs in order to decide what went wrong.
  const existing = findCopyByBarcode(db, barcode);
  if (existing !== null) {
    throw new DomainError(
      'DUPLICATE_BARCODE',
      `הברקוד ${barcode} כבר רשום על "${existing.bookTitle}".`,
      'barcode',
    );
  }

  const title = requireText(input.title, 'title', 'שם הספר', 300);
  const author = optionalText(input.authorText, 'authorText', 'מחבר', 300);
  const isbnText = optionalText(input.isbn13, 'isbn13', 'מסתב', 30);
  const isbn = isbnText === null ? null : isbnText.replace(/[\s-]/g, '');

  if (isbn !== null && !/^\d{13}$/.test(isbn)) {
    throw new DomainError('VALIDATION', 'מסתב אינו תקין — נדרשות 13 ספרות.', 'isbn13');
  }

  const categoryPublicId = optionalText(input.categoryPublicId, 'categoryPublicId', 'קטגוריה', 100);
  const shelfPublicId = optionalText(input.shelfPublicId, 'shelfPublicId', 'מיקום מדף', 100);

  // One transaction: a copy without its title, or a title without its copy,
  // would both be wrong.
  const commit = db.transaction(() => {
    const { book, created } = findOrCreateBook(db, { title, author, isbn, categoryPublicId });
    const copy = createCopy(db, { bookPublicId: book.publicId, barcode, shelfPublicId });

    // Re-read the title: `copyCount` was counted before this copy existed, and
    // the screen reports it back to the librarian as "now N copies".
    return { copy, book: getBook(db, book.publicId), createdTitle: created };
  });

  return commit();
}
