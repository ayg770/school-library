import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import {
  fromDbBool,
  likePattern,
  normalisePage,
  nowIso,
  optionalText,
  requireBarcode,
  requireText,
  resolveReference,
  toDbBool,
  translateUniqueViolation,
} from './common.js';
import { DomainError, notFound } from './errors.js';

export interface Student {
  readonly publicId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly classPublicId: string | null;
  readonly className: string | null;
  /** Optional barcode on a student card. Distinct from any external id (§8). */
  readonly localBarcode: string | null;
  readonly active: boolean;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateStudentInput {
  readonly firstName: unknown;
  readonly lastName: unknown;
  readonly classPublicId?: unknown;
  readonly localBarcode?: unknown;
  readonly notes?: unknown;
}

export interface UpdateStudentInput extends Partial<CreateStudentInput> {
  readonly active?: boolean;
}

export interface ListStudentsOptions {
  readonly query?: string;
  readonly classPublicId?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

interface StudentRow {
  public_id: string;
  first_name: string;
  last_name: string;
  class_public_id: string | null;
  class_name: string | null;
  local_barcode: string | null;
  active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT s.public_id, s.first_name, s.last_name,
         c.public_id AS class_public_id, c.name AS class_name,
         s.local_barcode, s.active, s.notes, s.created_at, s.updated_at
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id`;

function map(row: StudentRow): Student {
  return {
    publicId: row.public_id,
    firstName: row.first_name,
    lastName: row.last_name,
    classPublicId: row.class_public_id,
    className: row.class_name,
    localBarcode: row.local_barcode,
    active: fromDbBool(row.active),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DUPLICATE_BARCODE = new DomainError(
  'DUPLICATE_BARCODE',
  'הברקוד הזה כבר משויך לתלמיד אחר.',
  'localBarcode',
);

export function createStudent(db: Db, input: CreateStudentInput): Student {
  const firstName = requireText(input.firstName, 'firstName', 'שם פרטי', 120);
  const lastName = requireText(input.lastName, 'lastName', 'שם משפחה', 120);
  const classPublicId = optionalText(input.classPublicId, 'classPublicId', 'כיתה', 100);
  const classId = resolveReference(db, 'classes', classPublicId, 'הכיתה', 'classPublicId');
  const localBarcode = input.localBarcode == null || input.localBarcode === '' ? null : requireBarcode(input.localBarcode, 'localBarcode');
  const notes = optionalText(input.notes, 'notes', 'הערות', 2000);

  const publicId = newPublicId();
  const timestamp = nowIso();

  try {
    db.prepare(
      `INSERT INTO students (public_id, first_name, last_name, class_id, local_barcode, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(publicId, firstName, lastName, classId, localBarcode, notes, timestamp, timestamp);
  } catch (error) {
    translateUniqueViolation(error, { 'students.local_barcode': DUPLICATE_BARCODE });
  }

  return getStudent(db, publicId);
}

export function getStudent(db: Db, publicId: string): Student {
  const row = db.prepare(`${SELECT} WHERE s.public_id = ?`).get(publicId) as StudentRow | undefined;
  if (row === undefined) throw notFound('התלמיד');
  return map(row);
}

export function findStudentByBarcode(db: Db, barcode: string): Student | null {
  const row = db.prepare(`${SELECT} WHERE s.local_barcode = ?`).get(barcode) as StudentRow | undefined;
  return row === undefined ? null : map(row);
}

/**
 * Updates a student.
 *
 * Setting `active` to false is how a student who has left is removed from
 * everyday use: §7 forbids hard-deleting anyone with history, because a loan
 * that was never returned must still show whose it was.
 */
export function updateStudent(db: Db, publicId: string, input: UpdateStudentInput): Student {
  const current = getStudent(db, publicId);

  const firstName =
    input.firstName === undefined ? current.firstName : requireText(input.firstName, 'firstName', 'שם פרטי', 120);
  const lastName =
    input.lastName === undefined ? current.lastName : requireText(input.lastName, 'lastName', 'שם משפחה', 120);
  const classPublicId =
    input.classPublicId === undefined
      ? current.classPublicId
      : optionalText(input.classPublicId, 'classPublicId', 'כיתה', 100);
  const classId = resolveReference(db, 'classes', classPublicId, 'הכיתה', 'classPublicId');
  const localBarcode =
    input.localBarcode === undefined
      ? current.localBarcode
      : input.localBarcode == null || input.localBarcode === ''
        ? null
        : requireBarcode(input.localBarcode, 'localBarcode');
  const notes = input.notes === undefined ? current.notes : optionalText(input.notes, 'notes', 'הערות', 2000);
  const active = input.active ?? current.active;

  try {
    db.prepare(
      `UPDATE students
          SET first_name = ?, last_name = ?, class_id = ?, local_barcode = ?, notes = ?, active = ?, updated_at = ?
        WHERE public_id = ?`,
    ).run(firstName, lastName, classId, localBarcode, notes, toDbBool(active), nowIso(), publicId);
  } catch (error) {
    translateUniqueViolation(error, { 'students.local_barcode': DUPLICATE_BARCODE });
  }

  return getStudent(db, publicId);
}

export function listStudents(
  db: Db,
  options: ListStudentsOptions = {},
): { items: Student[]; total: number } {
  const { limit, offset } = normalisePage(options.limit, options.offset);
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.query !== undefined && options.query.trim() !== '') {
    where.push(
      `(s.first_name LIKE ? ESCAPE '\\' OR s.last_name LIKE ? ESCAPE '\\'
        OR (s.first_name || ' ' || s.last_name) LIKE ? ESCAPE '\\'
        OR s.local_barcode = ?)`,
    );
    const pattern = likePattern(options.query);
    // The barcode is matched exactly, never as a fragment (§14).
    params.push(pattern, pattern, pattern, options.query);
  }
  if (options.classPublicId !== undefined && options.classPublicId !== '') {
    where.push('c.public_id = ?');
    params.push(options.classPublicId);
  }
  if (options.active !== undefined) {
    where.push('s.active = ?');
    params.push(toDbBool(options.active));
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM students s LEFT JOIN classes c ON c.id = s.class_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${SELECT} ${clause} ORDER BY s.last_name, s.first_name LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as StudentRow[];

  return { items: rows.map(map), total };
}
