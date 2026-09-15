import type { Db } from '../db/open.js';
import { newPublicId } from '../ids.js';
import { readSettings } from '../settings.js';
import { recordAudit } from './audit.js';
import { normalisePage, nowIso, optionalText, requireBarcode } from './common.js';
import { DomainError, notFound } from './errors.js';
import { getStudent, type Student } from './students.js';

export interface Loan {
  readonly publicId: string;
  readonly copyPublicId: string;
  readonly barcode: string;
  readonly bookPublicId: string;
  readonly bookTitle: string;
  readonly bookAuthor: string | null;
  readonly studentPublicId: string;
  readonly studentFirstName: string;
  readonly studentLastName: string;
  readonly className: string | null;
  readonly checkoutAt: string;
  readonly dueAt: string | null;
  readonly returnedAt: string | null;
  readonly renewalCount: number;
  readonly notes: string | null;
  /** Open, past its due date, and not yet returned. */
  readonly overdue: boolean;
  readonly daysOverdue: number;
}

export interface CheckoutInput {
  /** The scanned copy barcode. Either this or `copyPublicId` is required. */
  readonly barcode?: string;
  readonly copyPublicId?: string;
  readonly studentPublicId: string;
  /** Overrides `default_loan_days` for this loan only. */
  readonly loanDays?: number;
  readonly staffUserId?: number | null;
  readonly notes?: string | null;
}

export interface CheckinResult {
  readonly loan: Loan;
  /** True when the book came back after its due date. */
  readonly wasOverdue: boolean;
}

export interface ListLoansOptions {
  readonly studentPublicId?: string;
  readonly copyPublicId?: string;
  /** Every loan across all copies of one title — the book card (§16). */
  readonly bookPublicId?: string;
  readonly status?: 'active' | 'overdue' | 'returned' | 'all';
  readonly limit?: number;
  readonly offset?: number;
}

export interface StudentLibrarySummary {
  readonly student: Student;
  readonly activeLoanCount: number;
  readonly overdueCount: number;
  readonly activeLoans: Loan[];
  readonly lifetimeLoanCount: number;
  readonly lastActivityAt: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Copies in these states cannot leave the library. */
const NON_CIRCULATING = new Set(['lost', 'withdrawn']);

interface LoanRow {
  public_id: string;
  copy_public_id: string;
  barcode: string;
  book_public_id: string;
  book_title: string;
  book_author: string | null;
  student_public_id: string;
  student_first_name: string;
  student_last_name: string;
  class_name: string | null;
  checkout_at: string;
  due_at: string | null;
  returned_at: string | null;
  renewal_count: number;
  notes: string | null;
}

const SELECT = `
  SELECT l.public_id, bc.public_id AS copy_public_id, bc.barcode,
         b.public_id AS book_public_id, b.title AS book_title, b.author_text AS book_author,
         s.public_id AS student_public_id, s.first_name AS student_first_name,
         s.last_name AS student_last_name, c.name AS class_name,
         l.checkout_at, l.due_at, l.returned_at, l.renewal_count, l.notes
    FROM loans l
    JOIN book_copies bc ON bc.id = l.copy_id
    JOIN books b ON b.id = bc.book_id
    JOIN students s ON s.id = l.student_id
    LEFT JOIN classes c ON c.id = s.class_id`;

function map(row: LoanRow, now: number = Date.now()): Loan {
  const dueMs = row.due_at === null ? null : Date.parse(row.due_at);
  const open = row.returned_at === null;
  const overdue = open && dueMs !== null && dueMs < now;

  return {
    publicId: row.public_id,
    copyPublicId: row.copy_public_id,
    barcode: row.barcode,
    bookPublicId: row.book_public_id,
    bookTitle: row.book_title,
    bookAuthor: row.book_author,
    studentPublicId: row.student_public_id,
    studentFirstName: row.student_first_name,
    studentLastName: row.student_last_name,
    className: row.class_name,
    checkoutAt: row.checkout_at,
    dueAt: row.due_at,
    returnedAt: row.returned_at,
    renewalCount: row.renewal_count,
    notes: row.notes,
    overdue,
    daysOverdue: overdue && dueMs !== null ? Math.floor((now - dueMs) / MS_PER_DAY) : 0,
  };
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * MS_PER_DAY).toISOString();
}

interface CopyLookup {
  id: number;
  public_id: string;
  barcode: string;
  active: number;
  condition_status: string;
  title: string;
}

/** Resolves the scanned copy, or explains precisely why it cannot be lent. */
function findCopyForCirculation(db: Db, input: { barcode?: string; copyPublicId?: string }): CopyLookup {
  let row: CopyLookup | undefined;

  if (input.barcode !== undefined) {
    const barcode = requireBarcode(input.barcode);
    row = db
      .prepare(
        `SELECT bc.id, bc.public_id, bc.barcode, bc.active, bc.condition_status, b.title
           FROM book_copies bc JOIN books b ON b.id = bc.book_id
          WHERE bc.barcode = ?`,
      )
      .get(barcode) as CopyLookup | undefined;
  } else if (input.copyPublicId !== undefined && input.copyPublicId !== '') {
    row = db
      .prepare(
        `SELECT bc.id, bc.public_id, bc.barcode, bc.active, bc.condition_status, b.title
           FROM book_copies bc JOIN books b ON b.id = bc.book_id
          WHERE bc.public_id = ?`,
      )
      .get(input.copyPublicId) as CopyLookup | undefined;
  } else {
    throw new DomainError('VALIDATION', 'יש לסרוק ברקוד של עותק.', 'barcode');
  }

  if (row === undefined) {
    throw new DomainError('COPY_NOT_FOUND', 'הברקוד לא נמצא במערכת.', 'barcode');
  }
  return row;
}

/** The open loan on a copy, if there is one. */
function activeLoanRow(db: Db, copyId: number): LoanRow | undefined {
  return db.prepare(`${SELECT} WHERE l.copy_id = ? AND l.returned_at IS NULL`).get(copyId) as
    | LoanRow
    | undefined;
}

/**
 * Lends one copy to one student.
 *
 * The loan and its audit entry commit together, so a green result means both
 * are on disk and nothing else is required — no network, no confirmation from
 * any other system (§23). When the integration outbox arrives in Phase 8 its
 * event joins this same transaction.
 *
 * Availability is checked before the insert for a clear message, but the
 * guarantee is the partial unique index: if two scans race, the second insert
 * fails and is reported as already on loan rather than creating a second open
 * loan for the same book.
 */
export function checkoutCopy(db: Db, input: CheckoutInput): Loan {
  const settings = readSettings(db);
  const student = getStudent(db, input.studentPublicId);

  if (!student.active) {
    throw new DomainError(
      'STUDENT_INACTIVE',
      `${student.firstName} ${student.lastName} מסומן כלא פעיל. הפעל את התלמיד לפני השאלה.`,
      'studentPublicId',
    );
  }

  const copy = findCopyForCirculation(db, input);

  if (copy.active !== 1) {
    throw new DomainError('COPY_NOT_AVAILABLE', `העותק ${copy.barcode} אינו פעיל בקטלוג.`, 'barcode');
  }
  if (NON_CIRCULATING.has(copy.condition_status)) {
    const label = copy.condition_status === 'lost' ? 'אבוד' : 'הוצא משימוש';
    throw new DomainError(
      'COPY_NOT_AVAILABLE',
      `העותק ${copy.barcode} מסומן כ${label} ולא ניתן להשאלה.`,
      'barcode',
    );
  }

  const existing = activeLoanRow(db, copy.id);
  if (existing !== undefined) {
    throw new DomainError(
      'COPY_ALREADY_ON_LOAN',
      `"${copy.title}" כבר מושאל ל${existing.student_first_name} ${existing.student_last_name}. יש להחזיר קודם.`,
      'barcode',
    );
  }

  const activeCount = countActiveLoans(db, student.publicId);
  const limit = settings.max_active_loans_per_student;
  if (limit > 0 && activeCount >= limit) {
    throw new DomainError(
      'LOAN_LIMIT_REACHED',
      `ל${student.firstName} ${student.lastName} כבר ${activeCount} ספרים מושאלים, וזו המכסה. יש להחזיר ספר לפני השאלה נוספת.`,
      'studentPublicId',
    );
  }

  const studentId = (
    db.prepare('SELECT id FROM students WHERE public_id = ?').get(student.publicId) as { id: number }
  ).id;

  const publicId = newPublicId();
  const checkoutAt = nowIso();
  const loanDays = input.loanDays ?? settings.default_loan_days;
  const dueAt = addDays(checkoutAt, loanDays);
  const notes = optionalText(input.notes, 'notes', 'הערות', 1000);

  const commit = db.transaction(() => {
    db.prepare(
      // A loan made here is confirmed by the act of making it: a librarian had
      // the book in their hand. Only a suggestion arriving from the office
      // (AD-9) is left unconfirmed, and only until this computer has seen it.
      `INSERT INTO loans (public_id, copy_id, student_id, checkout_at, due_at,
                          checkout_by_user_id, notes, origin, confirmed_at,
                          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'library', ?, ?, ?)`,
    ).run(
      publicId,
      copy.id,
      studentId,
      checkoutAt,
      dueAt,
      input.staffUserId ?? null,
      notes,
      checkoutAt,
      checkoutAt,
      checkoutAt,
    );

    recordAudit(db, {
      action: 'loan.checked_out',
      entityType: 'loan',
      entityId: publicId,
      userId: input.staffUserId ?? null,
      newData: { barcode: copy.barcode, studentPublicId: student.publicId, dueAt },
    });
  });

  try {
    commit();
  } catch (error) {
    // The partial unique index rejected a second open loan on this copy.
    if (error instanceof Error && error.message.includes('idx_loans_one_active_per_copy')) {
      throw new DomainError(
        'COPY_ALREADY_ON_LOAN',
        `"${copy.title}" כבר מושאל. רענן את המסך ונסה שוב.`,
        'barcode',
      );
    }
    throw error;
  }

  return getLoan(db, publicId);
}

/**
 * Takes a copy back.
 *
 * §11: an ordinary return needs only the book — the borrower is already
 * recorded on the loan, so asking the librarian to find the student first
 * would slow the queue down for nothing.
 */
export function checkinByBarcode(db: Db, barcode: string, staffUserId?: number | null): CheckinResult {
  const copy = findCopyForCirculation(db, { barcode });
  const row = activeLoanRow(db, copy.id);

  if (row === undefined) {
    throw new DomainError('NOT_ON_LOAN', `"${copy.title}" אינו מושאל כרגע.`, 'barcode');
  }

  const before = map(row);
  const returnedAt = nowIso();

  const commit = db.transaction(() => {
    db.prepare(
      'UPDATE loans SET returned_at = ?, return_by_user_id = ?, updated_at = ? WHERE public_id = ?',
    ).run(returnedAt, staffUserId ?? null, returnedAt, before.publicId);

    recordAudit(db, {
      action: 'loan.returned',
      entityType: 'loan',
      entityId: before.publicId,
      userId: staffUserId ?? null,
      oldData: { dueAt: before.dueAt, overdue: before.overdue },
      newData: { returnedAt },
    });
  });

  commit();

  return { loan: getLoan(db, before.publicId), wasOverdue: before.overdue };
}

/** Extends an open loan. */
export function renewLoan(
  db: Db,
  loanPublicId: string,
  options: { extraDays?: number; staffUserId?: number | null } = {},
): Loan {
  const loan = getLoan(db, loanPublicId);

  if (loan.returnedAt !== null) {
    throw new DomainError('LOAN_ALREADY_RETURNED', 'ההשאלה כבר הוחזרה ולא ניתן להאריך אותה.');
  }

  const settings = readSettings(db);
  const extraDays = options.extraDays ?? settings.default_loan_days;
  // Extend from today when the loan is already late, so a renewal always gives
  // the full period rather than a date that has already passed.
  const base = loan.dueAt === null || loan.overdue ? nowIso() : loan.dueAt;
  const dueAt = addDays(base, extraDays);
  const timestamp = nowIso();

  const commit = db.transaction(() => {
    db.prepare(
      'UPDATE loans SET due_at = ?, renewal_count = renewal_count + 1, updated_at = ? WHERE public_id = ?',
    ).run(dueAt, timestamp, loanPublicId);

    recordAudit(db, {
      action: 'loan.renewed',
      entityType: 'loan',
      entityId: loanPublicId,
      userId: options.staffUserId ?? null,
      oldData: { dueAt: loan.dueAt, renewalCount: loan.renewalCount },
      newData: { dueAt, renewalCount: loan.renewalCount + 1 },
    });
  });

  commit();

  return getLoan(db, loanPublicId);
}

export function getLoan(db: Db, publicId: string): Loan {
  const row = db.prepare(`${SELECT} WHERE l.public_id = ?`).get(publicId) as LoanRow | undefined;
  if (row === undefined) throw notFound('ההשאלה');
  return map(row);
}

export function countActiveLoans(db: Db, studentPublicId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM loans l JOIN students s ON s.id = l.student_id
          WHERE s.public_id = ? AND l.returned_at IS NULL`,
      )
      .get(studentPublicId) as { n: number }
  ).n;
}

export function listLoans(db: Db, options: ListLoansOptions = {}): { items: Loan[]; total: number } {
  const { limit, offset } = normalisePage(options.limit, options.offset);
  const where: string[] = [];
  const params: unknown[] = [];
  const now = nowIso();

  switch (options.status ?? 'active') {
    case 'active':
      where.push('l.returned_at IS NULL');
      break;
    case 'overdue':
      where.push('l.returned_at IS NULL AND l.due_at IS NOT NULL AND l.due_at < ?');
      params.push(now);
      break;
    case 'returned':
      where.push('l.returned_at IS NOT NULL');
      break;
    case 'all':
      break;
  }

  if (options.studentPublicId !== undefined && options.studentPublicId !== '') {
    where.push('s.public_id = ?');
    params.push(options.studentPublicId);
  }
  if (options.copyPublicId !== undefined && options.copyPublicId !== '') {
    where.push('bc.public_id = ?');
    params.push(options.copyPublicId);
  }
  if (options.bookPublicId !== undefined && options.bookPublicId !== '') {
    where.push('b.public_id = ?');
    params.push(options.bookPublicId);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n
           FROM loans l
           JOIN book_copies bc ON bc.id = l.copy_id
           JOIN books b ON b.id = bc.book_id
           JOIN students s ON s.id = l.student_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(
      `${SELECT} ${clause}
        ORDER BY CASE WHEN l.returned_at IS NULL THEN 0 ELSE 1 END, l.due_at, l.checkout_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as LoanRow[];

  return { items: rows.map((row) => map(row)), total };
}

/**
 * Everything the student card shows (§15), and the same shape the future
 * `library-summary` integration endpoint will return (§8) — built once so the
 * two cannot disagree.
 */
export function getStudentLibrarySummary(db: Db, studentPublicId: string): StudentLibrarySummary {
  const student = getStudent(db, studentPublicId);
  const active = listLoans(db, { studentPublicId, status: 'active', limit: 200 });

  const lifetime = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM loans l JOIN students s ON s.id = l.student_id WHERE s.public_id = ?`,
      )
      .get(studentPublicId) as { n: number }
  ).n;

  const last = db
    .prepare(
      `SELECT MAX(COALESCE(l.returned_at, l.checkout_at)) AS at
         FROM loans l JOIN students s ON s.id = l.student_id
        WHERE s.public_id = ?`,
    )
    .get(studentPublicId) as { at: string | null };

  return {
    student,
    activeLoanCount: active.total,
    overdueCount: active.items.filter((loan) => loan.overdue).length,
    activeLoans: active.items,
    lifetimeLoanCount: lifetime,
    lastActivityAt: last.at,
  };
}
