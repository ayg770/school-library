import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import {
  fromDbBool,
  normalisePage,
  nowIso,
  optionalText,
  requireBarcode,
  resolveReference,
  toDbBool,
  translateUniqueViolation,
} from './common.js';
import { DomainError, notFound } from './errors.js';

export const CONDITION_STATUSES = ['normal', 'damaged', 'lost', 'repair', 'withdrawn'] as const;
export type ConditionStatus = (typeof CONDITION_STATUSES)[number];

export interface BookCopy {
  readonly publicId: string;
  readonly bookPublicId: string;
  readonly bookTitle: string;
  readonly bookAuthor: string | null;
  /** Stored exactly as supplied — never trimmed or reformatted (§7, §34). */
  readonly barcode: string;
  readonly legacyId: string | null;
  readonly accessionNumber: string | null;
  readonly shelfPublicId: string | null;
  readonly shelfName: string | null;
  readonly conditionStatus: ConditionStatus;
  readonly purchaseDate: string | null;
  readonly priceCents: number | null;
  readonly conditionNote: string | null;
  /** Set when the copy was last confirmed present on the shelf (Phase 4). */
  readonly verifiedAt: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCopyInput {
  readonly bookPublicId: unknown;
  readonly barcode: unknown;
  readonly legacyId?: unknown;
  readonly accessionNumber?: unknown;
  readonly shelfPublicId?: unknown;
  readonly conditionStatus?: unknown;
  readonly purchaseDate?: unknown;
  readonly priceCents?: unknown;
  readonly conditionNote?: unknown;
}

export interface UpdateCopyInput extends Partial<Omit<CreateCopyInput, 'bookPublicId'>> {
  readonly active?: boolean;
  readonly verifiedAt?: string | null;
}

export interface ListCopiesOptions {
  readonly bookPublicId?: string;
  readonly shelfPublicId?: string;
  readonly conditionStatus?: ConditionStatus;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

interface CopyRow {
  public_id: string;
  book_public_id: string;
  book_title: string;
  book_author: string | null;
  barcode: string;
  legacy_id: string | null;
  accession_number: string | null;
  shelf_public_id: string | null;
  shelf_name: string | null;
  condition_status: ConditionStatus;
  purchase_date: string | null;
  price_cents: number | null;
  condition_note: string | null;
  verified_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT bc.public_id, b.public_id AS book_public_id, b.title AS book_title, b.author_text AS book_author,
         bc.barcode, bc.legacy_id, bc.accession_number,
         sl.public_id AS shelf_public_id, sl.name AS shelf_name,
         bc.condition_status, bc.purchase_date, bc.price_cents, bc.condition_note,
         bc.verified_at, bc.active, bc.created_at, bc.updated_at
    FROM book_copies bc
    JOIN books b ON b.id = bc.book_id
    LEFT JOIN shelf_locations sl ON sl.id = bc.shelf_location_id`;

function map(row: CopyRow): BookCopy {
  return {
    publicId: row.public_id,
    bookPublicId: row.book_public_id,
    bookTitle: row.book_title,
    bookAuthor: row.book_author,
    barcode: row.barcode,
    legacyId: row.legacy_id,
    accessionNumber: row.accession_number,
    shelfPublicId: row.shelf_public_id,
    shelfName: row.shelf_name,
    conditionStatus: row.condition_status,
    purchaseDate: row.purchase_date,
    priceCents: row.price_cents,
    conditionNote: row.condition_note,
    verifiedAt: row.verified_at,
    active: fromDbBool(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function duplicateBarcode(barcode: string): DomainError {
  return new DomainError(
    'DUPLICATE_BARCODE',
    `הברקוד ${barcode} כבר קיים על עותק אחר. סרוק שוב או בדוק את המדבקה.`,
    'barcode',
  );
}

function requireConditionStatus(value: unknown, fallback: ConditionStatus): ConditionStatus {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !CONDITION_STATUSES.includes(value as ConditionStatus)) {
    throw new DomainError('VALIDATION', 'מצב העותק אינו תקין.', 'conditionStatus');
  }
  return value as ConditionStatus;
}

function optionalPrice(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const price = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(price) || price < 0) {
    throw new DomainError('VALIDATION', 'המחיר חייב להיות מספר שלם באגורות, ולא שלילי.', 'priceCents');
  }
  return price;
}

export function createCopy(db: Db, input: CreateCopyInput): BookCopy {
  const bookPublicId = optionalText(input.bookPublicId, 'bookPublicId', 'ספר', 100);
  if (bookPublicId === null) {
    throw new DomainError('VALIDATION', 'יש לבחור לאיזה ספר שייך העותק.', 'bookPublicId');
  }
  const bookId = resolveReference(db, 'books', bookPublicId, 'הספר', 'bookPublicId');

  const barcode = requireBarcode(input.barcode);
  const shelfId = resolveReference(
    db,
    'shelf_locations',
    optionalText(input.shelfPublicId, 'shelfPublicId', 'מיקום מדף', 100),
    'מיקום המדף',
    'shelfPublicId',
  );

  const publicId = newPublicId();
  const timestamp = nowIso();

  try {
    db.prepare(
      `INSERT INTO book_copies (public_id, book_id, barcode, legacy_id, accession_number,
                                shelf_location_id, condition_status, purchase_date, price_cents,
                                condition_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      publicId,
      bookId,
      barcode,
      optionalText(input.legacyId, 'legacyId', 'מזהה ישן', 100),
      optionalText(input.accessionNumber, 'accessionNumber', 'מספר קטלוגי', 100),
      shelfId,
      requireConditionStatus(input.conditionStatus, 'normal'),
      optionalText(input.purchaseDate, 'purchaseDate', 'תאריך רכישה', 40),
      optionalPrice(input.priceCents, null),
      optionalText(input.conditionNote, 'conditionNote', 'הערת מצב', 1000),
      timestamp,
      timestamp,
    );
  } catch (error) {
    translateUniqueViolation(error, { 'book_copies.barcode': duplicateBarcode(barcode) });
  }

  return getCopy(db, publicId);
}

export function getCopy(db: Db, publicId: string): BookCopy {
  const row = db.prepare(`${SELECT} WHERE bc.public_id = ?`).get(publicId) as CopyRow | undefined;
  if (row === undefined) throw notFound('העותק');
  return map(row);
}

/**
 * Exact, indexed barcode lookup — the critical path for circulation (§22).
 *
 * Returns null rather than throwing: an unrecognised scan is an ordinary
 * outcome the interface handles with "barcode not found" and its options (§11),
 * not an error.
 */
export function findCopyByBarcode(db: Db, barcode: string): BookCopy | null {
  const row = db.prepare(`${SELECT} WHERE bc.barcode = ?`).get(barcode) as CopyRow | undefined;
  return row === undefined ? null : map(row);
}

export function updateCopy(db: Db, publicId: string, input: UpdateCopyInput): BookCopy {
  const current = getCopy(db, publicId);

  const barcode = input.barcode === undefined ? current.barcode : requireBarcode(input.barcode);
  const shelfId =
    input.shelfPublicId === undefined
      ? resolveReference(db, 'shelf_locations', current.shelfPublicId, 'מיקום המדף', 'shelfPublicId')
      : resolveReference(
          db,
          'shelf_locations',
          optionalText(input.shelfPublicId, 'shelfPublicId', 'מיקום מדף', 100),
          'מיקום המדף',
          'shelfPublicId',
        );

  const legacyId =
    input.legacyId === undefined ? current.legacyId : optionalText(input.legacyId, 'legacyId', 'מזהה ישן', 100);
  const accessionNumber =
    input.accessionNumber === undefined
      ? current.accessionNumber
      : optionalText(input.accessionNumber, 'accessionNumber', 'מספר קטלוגי', 100);
  const purchaseDate =
    input.purchaseDate === undefined
      ? current.purchaseDate
      : optionalText(input.purchaseDate, 'purchaseDate', 'תאריך רכישה', 40);
  const conditionNote =
    input.conditionNote === undefined
      ? current.conditionNote
      : optionalText(input.conditionNote, 'conditionNote', 'הערת מצב', 1000);

  try {
    db.prepare(
      `UPDATE book_copies
          SET barcode = ?, legacy_id = ?, accession_number = ?, shelf_location_id = ?,
              condition_status = ?, purchase_date = ?, price_cents = ?, condition_note = ?,
              verified_at = ?, active = ?, updated_at = ?
        WHERE public_id = ?`,
    ).run(
      barcode,
      legacyId,
      accessionNumber,
      shelfId,
      requireConditionStatus(input.conditionStatus, current.conditionStatus),
      purchaseDate,
      optionalPrice(input.priceCents, current.priceCents),
      conditionNote,
      input.verifiedAt === undefined ? current.verifiedAt : input.verifiedAt,
      toDbBool(input.active ?? current.active),
      nowIso(),
      publicId,
    );
  } catch (error) {
    translateUniqueViolation(error, { 'book_copies.barcode': duplicateBarcode(barcode) });
  }

  return getCopy(db, publicId);
}

export function listCopies(db: Db, options: ListCopiesOptions = {}): { items: BookCopy[]; total: number } {
  const { limit, offset } = normalisePage(options.limit, options.offset);
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.bookPublicId !== undefined && options.bookPublicId !== '') {
    where.push('b.public_id = ?');
    params.push(options.bookPublicId);
  }
  if (options.shelfPublicId !== undefined && options.shelfPublicId !== '') {
    where.push('sl.public_id = ?');
    params.push(options.shelfPublicId);
  }
  if (options.conditionStatus !== undefined) {
    where.push('bc.condition_status = ?');
    params.push(options.conditionStatus);
  }
  if (options.active !== undefined) {
    where.push('bc.active = ?');
    params.push(toDbBool(options.active));
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM book_copies bc
           JOIN books b ON b.id = bc.book_id
           LEFT JOIN shelf_locations sl ON sl.id = bc.shelf_location_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${SELECT} ${clause} ORDER BY b.title, bc.barcode LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as CopyRow[];

  return { items: rows.map(map), total };
}
