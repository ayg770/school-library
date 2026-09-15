import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { fromDbBool, nowIso, optionalText, requireText, resolveReference, toDbBool } from './common.js';
import { DomainError, notFound } from './errors.js';

export interface Category {
  readonly publicId: string;
  readonly name: string;
  readonly parentPublicId: string | null;
  /**
   * How long books in this category go out for, when the category decides.
   *
   * Null means the library-wide default. Textbooks are the reason it exists:
   * they are lent for the school year, and a librarian should not have to
   * remember that at the desk.
   */
  readonly loanDays: number | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateCategoryInput {
  readonly name: unknown;
  readonly parentPublicId?: unknown;
  readonly loanDays?: unknown;
}

export interface UpdateCategoryInput extends Partial<CreateCategoryInput> {
  readonly active?: boolean;
}

interface CategoryRow {
  public_id: string;
  name: string;
  parent_public_id: string | null;
  loan_days: number | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT c.public_id, c.name, p.public_id AS parent_public_id, c.loan_days,
         c.active, c.created_at, c.updated_at
    FROM categories c
    LEFT JOIN categories p ON p.id = c.parent_id`;

function map(row: CategoryRow): Category {
  return {
    publicId: row.public_id,
    name: row.name,
    parentPublicId: row.parent_public_id,
    loanDays: row.loan_days,
    active: fromDbBool(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createCategory(db: Db, input: CreateCategoryInput): Category {
  const name = requireText(input.name, 'name', 'שם הקטגוריה', 120);
  const parentPublicId = optionalText(input.parentPublicId, 'parentPublicId', 'קטגוריית אב', 100);
  const parentId = resolveReference(db, 'categories', parentPublicId, 'קטגוריית האב', 'parentPublicId');

  const loanDays = requireLoanDays(input.loanDays);
  const publicId = newPublicId();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO categories (public_id, name, parent_id, loan_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(publicId, name, parentId, loanDays, timestamp, timestamp);

  return getCategory(db, publicId);
}

export function getCategory(db: Db, publicId: string): Category {
  const row = db.prepare(`${SELECT} WHERE c.public_id = ?`).get(publicId) as CategoryRow | undefined;
  if (row === undefined) throw notFound('הקטגוריה');
  return map(row);
}

export function updateCategory(db: Db, publicId: string, input: UpdateCategoryInput): Category {
  const current = getCategory(db, publicId);

  const name = input.name === undefined ? current.name : requireText(input.name, 'name', 'שם הקטגוריה', 120);
  const parentPublicId =
    input.parentPublicId === undefined
      ? current.parentPublicId
      : optionalText(input.parentPublicId, 'parentPublicId', 'קטגוריית אב', 100);

  // A category that is its own ancestor makes the tree unwalkable, and the
  // recursive query that renders it would never terminate.
  if (parentPublicId !== null) {
    if (parentPublicId === publicId) {
      throw new DomainError('INVALID_PARENT', 'קטגוריה לא יכולה להיות אב של עצמה.', 'parentPublicId');
    }
    if (isDescendant(db, publicId, parentPublicId)) {
      throw new DomainError(
        'INVALID_PARENT',
        'לא ניתן להעביר קטגוריה אל תוך קטגוריה שנמצאת תחתיה.',
        'parentPublicId',
      );
    }
  }

  const parentId = resolveReference(db, 'categories', parentPublicId, 'קטגוריית האב', 'parentPublicId');
  const active = input.active ?? current.active;
  const loanDays = input.loanDays === undefined ? current.loanDays : requireLoanDays(input.loanDays);

  db.prepare(
    `UPDATE categories SET name = ?, parent_id = ?, loan_days = ?, active = ?, updated_at = ?
      WHERE public_id = ?`,
  ).run(name, parentId, loanDays, toDbBool(active), nowIso(), publicId);

  return getCategory(db, publicId);
}

/**
 * A loan period, or null for "use the library's".
 *
 * An upper bound because a typo of 3650 would put a book beyond every overdue
 * report for a decade, and nobody would notice until the shelf was empty.
 */
const MAX_LOAN_DAYS = 400;

function requireLoanDays(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;

  const days = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(days) || days < 1 || days > MAX_LOAN_DAYS) {
    throw new DomainError(
      'VALIDATION',
      `תקופת ההשאלה צריכה להיות מספר ימים בין 1 ל-${MAX_LOAN_DAYS}.`,
      'loanDays',
    );
  }
  return days;
}

/** True when `candidatePublicId` sits somewhere beneath `ancestorPublicId`. */
function isDescendant(db: Db, ancestorPublicId: string, candidatePublicId: string): boolean {
  const rows = db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
         SELECT id FROM categories WHERE public_id = ?
         UNION
         SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
       )
       SELECT 1 AS hit
         FROM categories
        WHERE public_id = ? AND id IN (SELECT id FROM descendants)`,
    )
    .all(ancestorPublicId, candidatePublicId) as Array<{ hit: number }>;

  return rows.length > 0;
}

export function listCategories(db: Db, options: { active?: boolean } = {}): Category[] {
  const clause = options.active === undefined ? '' : 'WHERE c.active = ?';
  const params = options.active === undefined ? [] : [toDbBool(options.active)];
  const rows = db.prepare(`${SELECT} ${clause} ORDER BY c.name`).all(...params) as CategoryRow[];
  return rows.map(map);
}
