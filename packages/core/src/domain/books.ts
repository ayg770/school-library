import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import {
  fromDbBool,
  likePattern,
  normalisePage,
  nowIso,
  optionalText,
  requireText,
  resolveReference,
  toDbBool,
} from './common.js';
import { DomainError, notFound } from './errors.js';

export interface Book {
  readonly publicId: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly authorText: string | null;
  readonly publisher: string | null;
  readonly publicationYear: string | null;
  readonly isbn10: string | null;
  readonly isbn13: string | null;
  readonly language: string | null;
  readonly categoryPublicId: string | null;
  readonly categoryName: string | null;
  readonly defaultCallNumber: string | null;
  readonly notes: string | null;
  readonly active: boolean;
  /** How many physical items exist for this title (§6). */
  readonly copyCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateBookInput {
  readonly title: unknown;
  readonly subtitle?: unknown;
  readonly authorText?: unknown;
  readonly publisher?: unknown;
  readonly publicationYear?: unknown;
  readonly isbn10?: unknown;
  readonly isbn13?: unknown;
  readonly language?: unknown;
  readonly categoryPublicId?: unknown;
  readonly defaultCallNumber?: unknown;
  readonly notes?: unknown;
}

export interface UpdateBookInput extends Partial<CreateBookInput> {
  readonly active?: boolean;
}

export interface ListBooksOptions {
  readonly query?: string;
  readonly categoryPublicId?: string;
  /**
   * Titles with at least one copy on this shelf.
   *
   * A shelf holds copies, not titles, so this asks about the copies and
   * reports the titles they belong to — which is what "what is on shelf 3"
   * means to the person standing in front of it.
   */
  readonly shelfPublicId?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

interface BookRow {
  public_id: string;
  title: string;
  subtitle: string | null;
  author_text: string | null;
  publisher: string | null;
  publication_year: string | null;
  isbn10: string | null;
  isbn13: string | null;
  language: string | null;
  category_public_id: string | null;
  category_name: string | null;
  default_call_number: string | null;
  notes: string | null;
  active: number;
  copy_count: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT b.public_id, b.title, b.subtitle, b.author_text, b.publisher, b.publication_year,
         b.isbn10, b.isbn13, b.language,
         cat.public_id AS category_public_id, cat.name AS category_name,
         b.default_call_number, b.notes, b.active,
         (SELECT COUNT(*) FROM book_copies bc WHERE bc.book_id = b.id) AS copy_count,
         b.created_at, b.updated_at
    FROM books b
    LEFT JOIN categories cat ON cat.id = b.category_id`;

function map(row: BookRow): Book {
  return {
    publicId: row.public_id,
    title: row.title,
    subtitle: row.subtitle,
    authorText: row.author_text,
    publisher: row.publisher,
    publicationYear: row.publication_year,
    isbn10: row.isbn10,
    isbn13: row.isbn13,
    language: row.language,
    categoryPublicId: row.category_public_id,
    categoryName: row.category_name,
    defaultCallNumber: row.default_call_number,
    notes: row.notes,
    active: fromDbBool(row.active),
    copyCount: row.copy_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Normalises an ISBN to digits (with a trailing X allowed on ISBN-10).
 *
 * Unlike a barcode, an ISBN identifies an edition rather than a physical item,
 * and the same ISBN is written with and without hyphens depending on the
 * source. Normalising makes those match. The barcode rule in §34 is untouched:
 * that applies to `book_copies.barcode`, which is stored exactly as scanned.
 */
function normaliseIsbn(value: unknown, field: 'isbn10' | 'isbn13'): string | null {
  const text = optionalText(value, field, 'מסת"ב', 30);
  if (text === null) return null;

  const cleaned = text.replace(/[\s-]/g, '').toUpperCase();
  const expectedLength = field === 'isbn10' ? 10 : 13;
  const pattern = field === 'isbn10' ? /^[0-9]{9}[0-9X]$/ : /^[0-9]{13}$/;

  if (!pattern.test(cleaned)) {
    throw new DomainError(
      'VALIDATION',
      `מסת"ב אינו תקין — נדרשות ${expectedLength} ספרות.`,
      field,
    );
  }
  return cleaned;
}

export function createBook(db: Db, input: CreateBookInput): Book {
  const values = validate(input);
  const categoryId = resolveCategory(db, input.categoryPublicId);
  const publicId = newPublicId();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO books (public_id, title, subtitle, author_text, publisher, publication_year,
                        isbn10, isbn13, language, category_id, default_call_number, notes,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    publicId,
    values.title,
    values.subtitle,
    values.authorText,
    values.publisher,
    values.publicationYear,
    values.isbn10,
    values.isbn13,
    values.language,
    categoryId,
    values.defaultCallNumber,
    values.notes,
    timestamp,
    timestamp,
  );

  return getBook(db, publicId);
}

function resolveCategory(db: Db, publicId: unknown): number | null {
  return resolveReference(
    db,
    'categories',
    optionalText(publicId, 'categoryPublicId', 'קטגוריה', 100),
    'הקטגוריה',
    'categoryPublicId',
  );
}

function validate(input: Partial<CreateBookInput>, current?: Book) {
  const pick = <T>(value: unknown, fallback: T, parse: () => T): T =>
    value === undefined && current !== undefined ? fallback : parse();

  return {
    title: pick(input.title, current?.title ?? '', () => requireText(input.title, 'title', 'שם הספר', 300)),
    subtitle: pick(input.subtitle, current?.subtitle ?? null, () =>
      optionalText(input.subtitle, 'subtitle', 'כותרת משנה', 300),
    ),
    authorText: pick(input.authorText, current?.authorText ?? null, () =>
      optionalText(input.authorText, 'authorText', 'מחבר', 300),
    ),
    publisher: pick(input.publisher, current?.publisher ?? null, () =>
      optionalText(input.publisher, 'publisher', 'הוצאה', 200),
    ),
    publicationYear: pick(input.publicationYear, current?.publicationYear ?? null, () =>
      optionalText(input.publicationYear, 'publicationYear', 'שנת הוצאה', 20),
    ),
    isbn10: pick(input.isbn10, current?.isbn10 ?? null, () => normaliseIsbn(input.isbn10, 'isbn10')),
    isbn13: pick(input.isbn13, current?.isbn13 ?? null, () => normaliseIsbn(input.isbn13, 'isbn13')),
    language: pick(input.language, current?.language ?? null, () =>
      optionalText(input.language, 'language', 'שפה', 60),
    ),
    defaultCallNumber: pick(input.defaultCallNumber, current?.defaultCallNumber ?? null, () =>
      optionalText(input.defaultCallNumber, 'defaultCallNumber', 'סימן מדף', 60),
    ),
    notes: pick(input.notes, current?.notes ?? null, () => optionalText(input.notes, 'notes', 'הערות', 2000)),
  };
}

export function getBook(db: Db, publicId: string): Book {
  const row = db.prepare(`${SELECT} WHERE b.public_id = ?`).get(publicId) as BookRow | undefined;
  if (row === undefined) throw notFound('הספר');
  return map(row);
}

export function updateBook(db: Db, publicId: string, input: UpdateBookInput): Book {
  const current = getBook(db, publicId);

  // `current` holds a public id while the row needs the internal id, and an
  // absent field must keep the category the book already has.
  const categoryId = resolveCategory(
    db,
    input.categoryPublicId === undefined ? current.categoryPublicId : input.categoryPublicId,
  );

  const values = validate(input, current);
  const active = input.active ?? current.active;

  db.prepare(
    `UPDATE books
        SET title = ?, subtitle = ?, author_text = ?, publisher = ?, publication_year = ?,
            isbn10 = ?, isbn13 = ?, language = ?, category_id = ?, default_call_number = ?,
            notes = ?, active = ?, updated_at = ?
      WHERE public_id = ?`,
  ).run(
    values.title,
    values.subtitle,
    values.authorText,
    values.publisher,
    values.publicationYear,
    values.isbn10,
    values.isbn13,
    values.language,
    categoryId,
    values.defaultCallNumber,
    values.notes,
    toDbBool(active),
    nowIso(),
    publicId,
  );

  return getBook(db, publicId);
}

export function listBooks(db: Db, options: ListBooksOptions = {}): { items: Book[]; total: number } {
  const { limit, offset } = normalisePage(options.limit, options.offset);
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.query !== undefined && options.query.trim() !== '') {
    where.push(
      `(b.title LIKE ? ESCAPE '\\' OR b.author_text LIKE ? ESCAPE '\\'
        OR b.isbn13 = ? OR b.isbn10 = ?
        OR EXISTS (SELECT 1 FROM book_copies bc WHERE bc.book_id = b.id AND bc.barcode = ?))`,
    );
    const pattern = likePattern(options.query);
    const exact = options.query.trim().replace(/[\s-]/g, '').toUpperCase();
    // Title and author match on a fragment; identifiers match exactly (§14).
    params.push(pattern, pattern, exact, exact, options.query.trim());
  }
  if (options.categoryPublicId !== undefined && options.categoryPublicId !== '') {
    where.push('cat.public_id = ?');
    params.push(options.categoryPublicId);
  }
  if (options.shelfPublicId !== undefined && options.shelfPublicId !== '') {
    where.push(
      `EXISTS (SELECT 1 FROM book_copies bc2
                 JOIN shelf_locations sl ON sl.id = bc2.shelf_location_id
                WHERE bc2.book_id = b.id AND sl.public_id = ?)`,
    );
    params.push(options.shelfPublicId);
  }
  if (options.active !== undefined) {
    where.push('b.active = ?');
    params.push(toDbBool(options.active));
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM books b LEFT JOIN categories cat ON cat.id = b.category_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${SELECT} ${clause} ORDER BY b.title LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as BookRow[];

  return { items: rows.map(map), total };
}
