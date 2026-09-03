import type { Db } from '../db/open.js';
import { createBook, listBooks } from '../domain/books.js';
import { createCategory, listCategories } from '../domain/categories.js';
import { createClass, listClasses } from '../domain/classes.js';
import { createCopy } from '../domain/copies.js';
import { nowIso } from '../domain/common.js';
import { DomainError, notFound } from '../domain/errors.js';
import { createShelf, listShelves } from '../domain/shelves.js';
import { createStudent } from '../domain/students.js';
import { newPublicId } from '../ids.js';
import { IMPORT_FIELDS, type ImportType } from './fields.js';
import type { ParsedSheet } from './parse.js';

export type RowStatus = 'pending' | 'ready' | 'warning' | 'error' | 'skipped' | 'imported' | 'failed';
export type BatchStatus = 'parsed' | 'validated' | 'committed' | 'cancelled';

/** Which column feeds which field. An absent key means the field is unmapped. */
export type ColumnMapping = Record<string, number>;

export interface ImportBatch {
  readonly publicId: string;
  readonly filename: string;
  readonly importType: ImportType;
  readonly status: BatchStatus;
  readonly mapping: ColumnMapping | null;
  readonly headers: string[];
  readonly totalRows: number;
  readonly successCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly startedAt: string;
  readonly finishedAt: string | null;
}

export interface ImportRow {
  readonly rowNumber: number;
  readonly raw: string[];
  readonly normalized: Record<string, string> | null;
  readonly status: RowStatus;
  readonly problems: string[];
  readonly createdEntityId: string | null;
}

const HEADER_ROW = 0;

interface BatchRow {
  id: number;
  public_id: string;
  filename: string;
  import_type: ImportType;
  status: BatchStatus;
  mapping_json: string | null;
  started_at: string;
  finished_at: string | null;
  total_rows: number;
  success_count: number;
  warning_count: number;
  error_count: number;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function loadBatchRow(db: Db, publicId: string): BatchRow {
  const row = db.prepare('SELECT * FROM import_batches WHERE public_id = ?').get(publicId) as
    | BatchRow
    | undefined;
  if (row === undefined) throw notFound('הייבוא');
  return row;
}

function headersOf(db: Db, batchId: number): string[] {
  const row = db
    .prepare('SELECT raw_data_json FROM import_rows WHERE batch_id = ? AND row_number = ?')
    .get(batchId, HEADER_ROW) as { raw_data_json: string } | undefined;
  return parseJson<string[]>(row?.raw_data_json ?? null, []);
}

function toBatch(db: Db, row: BatchRow): ImportBatch {
  return {
    publicId: row.public_id,
    filename: row.filename,
    importType: row.import_type,
    status: row.status,
    mapping: parseJson<ColumnMapping | null>(row.mapping_json, null),
    headers: headersOf(db, row.id),
    totalRows: row.total_rows,
    successCount: row.success_count,
    warningCount: row.warning_count,
    errorCount: row.error_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/**
 * Stages a parsed file.
 *
 * The header row is stored as row 0 alongside the data, so the batch remains a
 * complete record of the file even once the original is gone (§13).
 */
export function createImportBatch(
  db: Db,
  input: { filename: string; importType: ImportType; sheet: ParsedSheet },
): ImportBatch {
  const publicId = newPublicId();
  const timestamp = nowIso();

  const commit = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO import_batches
           (public_id, filename, import_type, status, started_at, total_rows, created_at, updated_at)
         VALUES (?, ?, ?, 'parsed', ?, ?, ?, ?)`,
      )
      .run(
        publicId,
        input.filename,
        input.importType,
        timestamp,
        input.sheet.rows.length,
        timestamp,
        timestamp,
      );

    const batchId = Number(result.lastInsertRowid);
    const insert = db.prepare(
      'INSERT INTO import_rows (batch_id, row_number, raw_data_json, status) VALUES (?, ?, ?, ?)',
    );

    insert.run(batchId, HEADER_ROW, JSON.stringify(input.sheet.headers), 'skipped');
    input.sheet.rows.forEach((row, index) => {
      insert.run(batchId, index + 1, JSON.stringify(row), 'pending');
    });
  });

  commit();
  return getImportBatch(db, publicId);
}

export function getImportBatch(db: Db, publicId: string): ImportBatch {
  return toBatch(db, loadBatchRow(db, publicId));
}

export function listImportBatches(db: Db, limit = 25): ImportBatch[] {
  const rows = db
    .prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT ?')
    .all(Math.min(limit, 100)) as BatchRow[];
  return rows.map((row) => toBatch(db, row));
}

export function listImportRows(
  db: Db,
  publicId: string,
  options: { status?: RowStatus; limit?: number; offset?: number } = {},
): { items: ImportRow[]; total: number } {
  const batch = loadBatchRow(db, publicId);
  const where = ['batch_id = ?', 'row_number > 0'];
  const params: unknown[] = [batch.id];

  if (options.status !== undefined) {
    where.push('status = ?');
    params.push(options.status);
  }

  const clause = `WHERE ${where.join(' AND ')}`;
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM import_rows ${clause}`).get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`SELECT * FROM import_rows ${clause} ORDER BY row_number LIMIT ? OFFSET ?`)
    .all(...params, Math.min(options.limit ?? 50, 500), options.offset ?? 0) as Array<{
    row_number: number;
    raw_data_json: string;
    normalized_data_json: string | null;
    status: RowStatus;
    error_json: string | null;
    created_entity_id: string | null;
  }>;

  return {
    total,
    items: rows.map((row) => ({
      rowNumber: row.row_number,
      raw: parseJson<string[]>(row.raw_data_json, []),
      normalized: parseJson<Record<string, string> | null>(row.normalized_data_json, null),
      status: row.status,
      problems: parseJson<string[]>(row.error_json, []),
      createdEntityId: row.created_entity_id,
    })),
  };
}

function valueFor(raw: string[], mapping: ColumnMapping, key: string): string {
  const index = mapping[key];
  if (index === undefined) return '';
  return (raw[index] ?? '').trim();
}

interface RowVerdict {
  readonly status: RowStatus;
  readonly normalized: Record<string, string>;
  readonly problems: string[];
}

function isBlank(raw: string[]): boolean {
  return raw.every((value) => value.trim() === '');
}

/**
 * Validates every row against the chosen mapping and records the verdict.
 *
 * Nothing reaches the catalogue here: §13 requires the librarian to see the
 * conflicts before any of it is committed. Duplicate barcodes are looked for
 * both within the file and against what is already stored, because both are
 * ordinary in a catalogue assembled over years.
 */
export function validateImportBatch(db: Db, publicId: string, mapping: ColumnMapping): ImportBatch {
  const batch = loadBatchRow(db, publicId);
  if (batch.status === 'committed') {
    throw new DomainError('VALIDATION', 'הייבוא כבר בוצע ולא ניתן לאמת אותו מחדש.');
  }

  for (const field of IMPORT_FIELDS[batch.import_type]) {
    if (field.required && mapping[field.key] === undefined) {
      throw new DomainError('VALIDATION', `יש למפות עמודה לשדה "${field.label}".`, field.key);
    }
  }

  const rows = db
    .prepare(
      `SELECT id, row_number, raw_data_json FROM import_rows
        WHERE batch_id = ? AND row_number > 0 ORDER BY row_number`,
    )
    .all(batch.id) as Array<{ id: number; row_number: number; raw_data_json: string }>;

  const barcodesInFile = new Map<string, number>();
  const namesInFile = new Map<string, number>();
  let ready = 0;
  let warnings = 0;
  let errors = 0;

  const update = db.prepare(
    'UPDATE import_rows SET normalized_data_json = ?, status = ?, error_json = ? WHERE id = ?',
  );

  const commit = db.transaction(() => {
    for (const row of rows) {
      const raw = parseJson<string[]>(row.raw_data_json, []);
      const verdict =
        batch.import_type === 'students'
          ? validateStudentRow(db, raw, mapping, barcodesInFile, namesInFile, row.row_number)
          : validateBookRow(db, raw, mapping, barcodesInFile, row.row_number);

      update.run(
        JSON.stringify(verdict.normalized),
        verdict.status,
        verdict.problems.length > 0 ? JSON.stringify(verdict.problems) : null,
        row.id,
      );

      if (verdict.status === 'ready') ready += 1;
      else if (verdict.status === 'warning') warnings += 1;
      else if (verdict.status === 'error') errors += 1;
    }

    db.prepare(
      `UPDATE import_batches
          SET mapping_json = ?, status = 'validated',
              success_count = ?, warning_count = ?, error_count = ?, updated_at = ?
        WHERE id = ?`,
    ).run(JSON.stringify(mapping), ready, warnings, errors, nowIso(), batch.id);
  });

  commit();
  return getImportBatch(db, publicId);
}

function validateStudentRow(
  db: Db,
  raw: string[],
  mapping: ColumnMapping,
  barcodesInFile: Map<string, number>,
  namesInFile: Map<string, number>,
  rowNumber: number,
): RowVerdict {
  if (isBlank(raw)) return { status: 'skipped', normalized: {}, problems: ['שורה ריקה'] };

  const normalized: Record<string, string> = {
    firstName: valueFor(raw, mapping, 'firstName'),
    lastName: valueFor(raw, mapping, 'lastName'),
    className: valueFor(raw, mapping, 'className'),
    localBarcode: valueFor(raw, mapping, 'localBarcode'),
    notes: valueFor(raw, mapping, 'notes'),
  };

  const problems: string[] = [];
  let status: RowStatus = 'ready';

  if (normalized.firstName === '') problems.push('חסר שם פרטי');
  if (normalized.lastName === '') problems.push('חסר שם משפחה');
  if (problems.length > 0) status = 'error';

  const barcode = normalized.localBarcode ?? '';
  if (barcode !== '') {
    if (/\s/.test(barcode)) {
      problems.push('הברקוד מכיל רווח. תקן את המקור');
      status = 'error';
    }
    const seenAt = barcodesInFile.get(barcode);
    if (seenAt !== undefined) {
      problems.push(`ברקוד כפול בקובץ, מופיע גם בשורה ${seenAt}`);
      status = 'error';
    } else {
      barcodesInFile.set(barcode, rowNumber);
      if (db.prepare('SELECT 1 FROM students WHERE local_barcode = ?').get(barcode) !== undefined) {
        problems.push('הברקוד כבר משויך לתלמיד קיים');
        status = 'error';
      }
    }
  }

  if (status !== 'error') {
    // Two people can genuinely share a name, so this warns rather than blocks.
    // The librarian gets to see it before it becomes a duplicate record.
    const key = `${normalized.firstName} ${normalized.lastName} ${normalized.className}`;
    const seenAt = namesInFile.get(key);
    if (seenAt !== undefined) {
      problems.push(`שם זהה מופיע גם בשורה ${seenAt}`);
      status = 'warning';
    } else {
      namesInFile.set(key, rowNumber);
    }

    const existing = db
      .prepare(
        `SELECT 1 FROM students s LEFT JOIN classes c ON c.id = s.class_id
          WHERE s.first_name = ? AND s.last_name = ? AND COALESCE(c.name, '') = ?`,
      )
      .get(normalized.firstName, normalized.lastName, normalized.className);
    if (existing !== undefined) {
      problems.push('תלמיד בשם הזה כבר קיים במערכת');
      status = 'warning';
    }
  }

  return { status, normalized, problems };
}

function validateBookRow(
  db: Db,
  raw: string[],
  mapping: ColumnMapping,
  barcodesInFile: Map<string, number>,
  rowNumber: number,
): RowVerdict {
  if (isBlank(raw)) return { status: 'skipped', normalized: {}, problems: ['שורה ריקה'] };

  const normalized: Record<string, string> = {
    title: valueFor(raw, mapping, 'title'),
    authorText: valueFor(raw, mapping, 'authorText'),
    barcode: valueFor(raw, mapping, 'barcode'),
    isbn13: valueFor(raw, mapping, 'isbn13'),
    publisher: valueFor(raw, mapping, 'publisher'),
    publicationYear: valueFor(raw, mapping, 'publicationYear'),
    categoryName: valueFor(raw, mapping, 'categoryName'),
    shelfName: valueFor(raw, mapping, 'shelfName'),
    accessionNumber: valueFor(raw, mapping, 'accessionNumber'),
    legacyId: valueFor(raw, mapping, 'legacyId'),
  };

  const problems: string[] = [];
  let status: RowStatus = 'ready';

  if (normalized.title === '') {
    problems.push('חסר שם ספר');
    status = 'error';
  }

  const barcode = normalized.barcode ?? '';
  if (barcode !== '') {
    if (/\s/.test(barcode)) {
      problems.push('הברקוד מכיל רווח. תקן את המקור');
      status = 'error';
    }
    const seenAt = barcodesInFile.get(barcode);
    if (seenAt !== undefined) {
      problems.push(`ברקוד כפול בקובץ, מופיע גם בשורה ${seenAt}`);
      status = 'error';
    } else {
      barcodesInFile.set(barcode, rowNumber);
      if (db.prepare('SELECT 1 FROM book_copies WHERE barcode = ?').get(barcode) !== undefined) {
        problems.push('הברקוד כבר קיים על עותק במערכת');
        status = 'error';
      }
    }
  } else if (status === 'ready') {
    problems.push('אין ברקוד, ייווצר ספר בלי עותק פיזי');
    status = 'warning';
  }

  const isbn = (normalized.isbn13 ?? '').replace(/[\s-]/g, '');
  if (isbn !== '' && !/^\d{13}$/.test(isbn)) {
    problems.push('מסתב אינו תקין, השדה יתעלם');
    normalized.isbn13 = '';
    if (status === 'ready') status = 'warning';
  } else {
    normalized.isbn13 = isbn;
  }

  return { status, normalized, problems };
}

/** Finds a row by name or creates it, remembering what it has already seen. */
function nameResolver(
  cache: Map<string, string>,
  find: (name: string) => string | undefined,
  create: (name: string) => string,
): (name: string) => string | null {
  return (name: string) => {
    const trimmed = name.trim();
    if (trimmed === '') return null;

    const cached = cache.get(trimmed);
    if (cached !== undefined) return cached;

    const publicId = find(trimmed) ?? create(trimmed);
    cache.set(trimmed, publicId);
    return publicId;
  };
}

export interface CommitReport {
  readonly batch: ImportBatch;
  readonly imported: number;
  readonly failed: number;
  readonly skipped: number;
  readonly createdClasses: string[];
  readonly createdCategories: string[];
  readonly createdShelves: string[];
}

/**
 * Applies the rows that passed validation.
 *
 * Rows marked `error` are left alone, because the librarian has already been
 * shown why. The batch commits in one transaction, but a row that fails at
 * this point is recorded as failed and the rest continue: one bad record in a
 * three-thousand-row catalogue should not cost the whole import.
 */
export function commitImportBatch(db: Db, publicId: string): CommitReport {
  const batch = loadBatchRow(db, publicId);

  if (batch.status === 'committed') {
    throw new DomainError('VALIDATION', 'הייבוא כבר בוצע.');
  }
  if (batch.status !== 'validated') {
    throw new DomainError('VALIDATION', 'יש לאמת את הייבוא לפני ביצועו.');
  }

  const rows = db
    .prepare(
      `SELECT id, row_number, normalized_data_json FROM import_rows
        WHERE batch_id = ? AND status IN ('ready', 'warning') ORDER BY row_number`,
    )
    .all(batch.id) as Array<{ id: number; row_number: number; normalized_data_json: string | null }>;

  const createdClasses: string[] = [];
  const createdCategories: string[] = [];
  const createdShelves: string[] = [];

  const resolveClass = nameResolver(
    new Map(),
    (name) =>
      listClasses(db, { query: name, limit: 200 }).items.find((item) => item.name === name)?.publicId,
    (name) => {
      createdClasses.push(name);
      return createClass(db, { name }).publicId;
    },
  );
  const resolveCategory = nameResolver(
    new Map(),
    (name) => listCategories(db).find((item) => item.name === name)?.publicId,
    (name) => {
      createdCategories.push(name);
      return createCategory(db, { name }).publicId;
    },
  );
  const resolveShelf = nameResolver(
    new Map(),
    (name) => listShelves(db).find((item) => item.name === name)?.publicId,
    (name) => {
      createdShelves.push(name);
      return createShelf(db, { name }).publicId;
    },
  );

  const markImported = db.prepare(
    "UPDATE import_rows SET status = 'imported', created_entity_id = ? WHERE id = ?",
  );
  const markFailed = db.prepare(
    "UPDATE import_rows SET status = 'failed', error_json = ? WHERE id = ?",
  );

  let imported = 0;
  let failed = 0;

  const commit = db.transaction(() => {
    for (const row of rows) {
      const data = parseJson<Record<string, string>>(row.normalized_data_json, {});
      try {
        const entityId =
          batch.import_type === 'students'
            ? importStudent(db, data, resolveClass)
            : importBook(db, data, resolveCategory, resolveShelf);
        markImported.run(entityId, row.id);
        imported += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
        markFailed.run(JSON.stringify([message]), row.id);
        failed += 1;
      }
    }

    const timestamp = nowIso();
    db.prepare(
      `UPDATE import_batches
          SET status = 'committed', finished_at = ?, success_count = ?,
              error_count = error_count + ?, updated_at = ?
        WHERE id = ?`,
    ).run(timestamp, imported, failed, timestamp, batch.id);
  });

  commit();

  const skipped = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM import_rows
          WHERE batch_id = ? AND row_number > 0 AND status IN ('error', 'skipped')`,
      )
      .get(batch.id) as { n: number }
  ).n;

  return {
    batch: getImportBatch(db, publicId),
    imported,
    failed,
    skipped,
    createdClasses,
    createdCategories,
    createdShelves,
  };
}

function importStudent(
  db: Db,
  data: Record<string, string>,
  resolveClass: (name: string) => string | null,
): string {
  return createStudent(db, {
    firstName: data.firstName ?? '',
    lastName: data.lastName ?? '',
    classPublicId: resolveClass(data.className ?? ''),
    localBarcode: data.localBarcode === '' ? null : data.localBarcode,
    notes: data.notes === '' ? null : data.notes,
  }).publicId;
}

/**
 * Creates the title if it is new, then attaches the copy.
 *
 * A catalogue export lists one row per physical item, so several rows share a
 * title. Matching on ISBN first and on title plus author second keeps five
 * copies of one book as one book with five copies (§6) rather than five books.
 */
function importBook(
  db: Db,
  data: Record<string, string>,
  resolveCategory: (name: string) => string | null,
  resolveShelf: (name: string) => string | null,
): string {
  const title = data.title ?? '';
  const author = data.authorText ?? '';
  const isbn = data.isbn13 ?? '';

  let bookPublicId: string | undefined;

  if (isbn !== '') {
    bookPublicId = listBooks(db, { query: isbn, limit: 5 }).items.find(
      (book) => book.isbn13 === isbn,
    )?.publicId;
  }
  if (bookPublicId === undefined) {
    bookPublicId = listBooks(db, { query: title, limit: 50 }).items.find(
      (book) => book.title === title && (book.authorText ?? '') === author,
    )?.publicId;
  }

  if (bookPublicId === undefined) {
    bookPublicId = createBook(db, {
      title,
      authorText: author === '' ? null : author,
      publisher: data.publisher === '' ? null : data.publisher,
      publicationYear: data.publicationYear === '' ? null : data.publicationYear,
      isbn13: isbn === '' ? null : isbn,
      categoryPublicId: resolveCategory(data.categoryName ?? ''),
    }).publicId;
  }

  const barcode = data.barcode ?? '';
  if (barcode === '') return bookPublicId;

  return createCopy(db, {
    bookPublicId,
    barcode,
    shelfPublicId: resolveShelf(data.shelfName ?? ''),
    accessionNumber: data.accessionNumber === '' ? null : data.accessionNumber,
    legacyId: data.legacyId === '' ? null : data.legacyId,
  }).publicId;
}

export function cancelImportBatch(db: Db, publicId: string): ImportBatch {
  const batch = loadBatchRow(db, publicId);
  if (batch.status === 'committed') {
    throw new DomainError('VALIDATION', 'ייבוא שבוצע לא ניתן לביטול.');
  }

  const timestamp = nowIso();
  db.prepare(
    "UPDATE import_batches SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?",
  ).run(timestamp, timestamp, batch.id);

  return getImportBatch(db, publicId);
}
