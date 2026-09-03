import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import {
  fromDbBool,
  likePattern,
  normalisePage,
  nowIso,
  optionalText,
  requireText,
  toDbBool,
} from './common.js';
import { notFound } from './errors.js';

export interface SchoolClass {
  readonly publicId: string;
  readonly name: string;
  readonly grade: string | null;
  readonly section: string | null;
  readonly academicYear: string | null;
  /** Identifier from the student-management system, when known (§8). */
  readonly externalClassId: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateClassInput {
  readonly name: unknown;
  readonly grade?: unknown;
  readonly section?: unknown;
  readonly academicYear?: unknown;
  readonly externalClassId?: unknown;
}

export interface UpdateClassInput extends Partial<CreateClassInput> {
  readonly active?: boolean;
}

export interface ListClassesOptions {
  readonly query?: string;
  readonly active?: boolean;
  readonly limit?: number;
  readonly offset?: number;
}

interface ClassRow {
  public_id: string;
  name: string;
  grade: string | null;
  section: string | null;
  academic_year: string | null;
  external_class_id: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

const COLUMNS = `public_id, name, grade, section, academic_year, external_class_id, active, created_at, updated_at`;

function map(row: ClassRow): SchoolClass {
  return {
    publicId: row.public_id,
    name: row.name,
    grade: row.grade,
    section: row.section,
    academicYear: row.academic_year,
    externalClassId: row.external_class_id,
    active: fromDbBool(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createClass(db: Db, input: CreateClassInput): SchoolClass {
  const name = requireText(input.name, 'name', 'שם הכיתה', 120);
  const grade = optionalText(input.grade, 'grade', 'שכבה', 40);
  const section = optionalText(input.section, 'section', 'מקבילה', 40);
  const academicYear = optionalText(input.academicYear, 'academicYear', 'שנת לימודים', 20);
  const externalClassId = optionalText(input.externalClassId, 'externalClassId', 'מזהה חיצוני', 100);

  const publicId = newPublicId();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO classes (public_id, name, grade, section, academic_year, external_class_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(publicId, name, grade, section, academicYear, externalClassId, timestamp, timestamp);

  return getClass(db, publicId);
}

export function getClass(db: Db, publicId: string): SchoolClass {
  const row = db.prepare(`SELECT ${COLUMNS} FROM classes WHERE public_id = ?`).get(publicId) as
    | ClassRow
    | undefined;
  if (row === undefined) throw notFound('הכיתה');
  return map(row);
}

export function updateClass(db: Db, publicId: string, input: UpdateClassInput): SchoolClass {
  const current = getClass(db, publicId);

  const name = input.name === undefined ? current.name : requireText(input.name, 'name', 'שם הכיתה', 120);
  const grade = input.grade === undefined ? current.grade : optionalText(input.grade, 'grade', 'שכבה', 40);
  const section =
    input.section === undefined ? current.section : optionalText(input.section, 'section', 'מקבילה', 40);
  const academicYear =
    input.academicYear === undefined
      ? current.academicYear
      : optionalText(input.academicYear, 'academicYear', 'שנת לימודים', 20);
  const externalClassId =
    input.externalClassId === undefined
      ? current.externalClassId
      : optionalText(input.externalClassId, 'externalClassId', 'מזהה חיצוני', 100);
  const active = input.active ?? current.active;

  db.prepare(
    `UPDATE classes
        SET name = ?, grade = ?, section = ?, academic_year = ?, external_class_id = ?,
            active = ?, updated_at = ?
      WHERE public_id = ?`,
  ).run(name, grade, section, academicYear, externalClassId, toDbBool(active), nowIso(), publicId);

  return getClass(db, publicId);
}

export function listClasses(
  db: Db,
  options: ListClassesOptions = {},
): { items: SchoolClass[]; total: number } {
  const { limit, offset } = normalisePage(options.limit, options.offset);
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.query !== undefined && options.query.trim() !== '') {
    where.push(`(name LIKE ? ESCAPE '\\' OR grade LIKE ? ESCAPE '\\')`);
    const pattern = likePattern(options.query);
    params.push(pattern, pattern);
  }
  if (options.active !== undefined) {
    where.push('active = ?');
    params.push(toDbBool(options.active));
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM classes ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM classes ${clause} ORDER BY name LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as ClassRow[];

  return { items: rows.map(map), total };
}
