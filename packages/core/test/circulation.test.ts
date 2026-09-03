import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DomainError,
  addDays,
  checkinByBarcode,
  checkoutCopy,
  createBook,
  createClass,
  createCopy,
  createStudent,
  getLoan,
  getStudentLibrarySummary,
  listAudit,
  listLoans,
  migrations,
  openDatabase,
  renewLoan,
  runMigrations,
  updateCopy,
  updateStudent,
  writeSetting,
  type Db,
} from '../src/index.js';

function expectDomainError(fn: () => unknown, code: string, note?: string): void {
  try {
    fn();
  } catch (error) {
    expect(error, note).toBeInstanceOf(DomainError);
    expect((error as DomainError).code, note).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} DomainError${note ? ` (${note})` : ''}`);
}

describe('circulation', () => {
  let db: Db;
  let studentId: string;
  let otherStudentId: string;
  let copyBarcode: string;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);

    const klass = createClass(db, { name: 'ז-1' });
    studentId = createStudent(db, {
      firstName: 'שרה',
      lastName: 'כהן',
      classPublicId: klass.publicId,
    }).publicId;
    otherStudentId = createStudent(db, { firstName: 'יוסי', lastName: 'מזרחי' }).publicId;

    const book = createBook(db, { title: 'מסילת ישרים', authorText: 'רמח"ל' });
    copyBarcode = createCopy(db, { bookPublicId: book.publicId, barcode: '001796' }).barcode;
  });

  afterEach(() => {
    db.close();
  });

  describe('checkout', () => {
    it('lends a copy and sets a due date from the settings', () => {
      writeSetting(db, 'default_loan_days', 14);
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });

      expect(loan.barcode).toBe('001796');
      expect(loan.bookTitle).toBe('מסילת ישרים');
      expect(loan.studentLastName).toBe('כהן');
      expect(loan.className).toBe('ז-1');
      expect(loan.returnedAt).toBeNull();
      expect(loan.overdue).toBe(false);
      expect(loan.renewalCount).toBe(0);

      const expected = Date.parse(addDays(loan.checkoutAt, 14));
      expect(Math.abs(Date.parse(loan.dueAt!) - expected)).toBeLessThan(1000);
    });

    it('records an audit entry in the same transaction as the loan', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      const entries = listAudit(db, { entityType: 'loan', entityId: loan.publicId });

      expect(entries).toHaveLength(1);
      expect(entries[0]?.action).toBe('loan.checked_out');
      expect(entries[0]?.newData).toMatchObject({ barcode: '001796' });
    });

    it('refuses a copy that is already out, and names who has it', () => {
      checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });

      try {
        checkoutCopy(db, { barcode: copyBarcode, studentPublicId: otherStudentId });
        expect.unreachable('expected the second checkout to fail');
      } catch (error) {
        expect((error as DomainError).code).toBe('COPY_ALREADY_ON_LOAN');
        expect((error as DomainError).message).toContain('שרה');
      }
    });

    it('leaves no audit entry behind when a checkout is refused', () => {
      checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      const before = listAudit(db, { action: 'loan.checked_out' }).length;

      expect(() => checkoutCopy(db, { barcode: copyBarcode, studentPublicId: otherStudentId })).toThrow();

      expect(listAudit(db, { action: 'loan.checked_out' })).toHaveLength(before);
    });

    it('lets the database enforce one open loan per copy', () => {
      checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });

      const copyId = (db.prepare('SELECT id FROM book_copies WHERE barcode = ?').get('001796') as {
        id: number;
      }).id;
      const otherId = (
        db.prepare('SELECT id FROM students WHERE public_id = ?').get(otherStudentId) as { id: number }
      ).id;

      // Bypassing the domain entirely: the partial unique index must still refuse.
      expect(() =>
        db
          .prepare(
            `INSERT INTO loans (public_id, copy_id, student_id, checkout_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run('forced', copyId, otherId, 'now', 'now', 'now'),
      ).toThrowError(/UNIQUE|constraint/i);
    });

    it('allows the same copy to go out again after it comes back', () => {
      checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      checkinByBarcode(db, copyBarcode);

      const second = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: otherStudentId });
      expect(second.studentLastName).toBe('מזרחי');
      expect(listLoans(db, { status: 'all' }).total).toBe(2);
    });

    it('refuses an unknown barcode', () => {
      expectDomainError(
        () => checkoutCopy(db, { barcode: '999999', studentPublicId: studentId }),
        'COPY_NOT_FOUND',
      );
    });

    it('refuses an inactive student', () => {
      updateStudent(db, studentId, { active: false });
      expectDomainError(
        () => checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId }),
        'STUDENT_INACTIVE',
      );
    });

    it('refuses a copy marked lost or withdrawn', () => {
      const book = createBook(db, { title: 'ספר' });
      const lost = createCopy(db, { bookPublicId: book.publicId, barcode: 'L1' });
      const withdrawn = createCopy(db, { bookPublicId: book.publicId, barcode: 'W1' });
      updateCopy(db, lost.publicId, { conditionStatus: 'lost' });
      updateCopy(db, withdrawn.publicId, { conditionStatus: 'withdrawn' });

      expectDomainError(
        () => checkoutCopy(db, { barcode: 'L1', studentPublicId: studentId }),
        'COPY_NOT_AVAILABLE',
        'lost',
      );
      expectDomainError(
        () => checkoutCopy(db, { barcode: 'W1', studentPublicId: studentId }),
        'COPY_NOT_AVAILABLE',
        'withdrawn',
      );
    });

    it('still lends a damaged copy', () => {
      const book = createBook(db, { title: 'ספר' });
      const copy = createCopy(db, { bookPublicId: book.publicId, barcode: 'D1' });
      updateCopy(db, copy.publicId, { conditionStatus: 'damaged' });

      expect(checkoutCopy(db, { barcode: 'D1', studentPublicId: studentId }).barcode).toBe('D1');
    });

    it('enforces the per-student loan limit', () => {
      writeSetting(db, 'max_active_loans_per_student', 2);
      const book = createBook(db, { title: 'ספר' });
      for (const barcode of ['A1', 'A2', 'A3']) {
        createCopy(db, { bookPublicId: book.publicId, barcode });
      }

      checkoutCopy(db, { barcode: 'A1', studentPublicId: studentId });
      checkoutCopy(db, { barcode: 'A2', studentPublicId: studentId });

      expectDomainError(
        () => checkoutCopy(db, { barcode: 'A3', studentPublicId: studentId }),
        'LOAN_LIMIT_REACHED',
      );

      // Returning one frees a slot.
      checkinByBarcode(db, 'A1');
      expect(checkoutCopy(db, { barcode: 'A3', studentPublicId: studentId }).barcode).toBe('A3');
    });

    it('treats a limit of zero as no limit', () => {
      writeSetting(db, 'max_active_loans_per_student', 0);
      const book = createBook(db, { title: 'ספר' });
      for (const barcode of ['B1', 'B2', 'B3', 'B4']) {
        createCopy(db, { bookPublicId: book.publicId, barcode });
        checkoutCopy(db, { barcode, studentPublicId: studentId });
      }

      expect(listLoans(db, { studentPublicId: studentId }).total).toBe(4);
    });
  });

  describe('return', () => {
    it('takes a book back on the book scan alone (§11)', () => {
      checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      const result = checkinByBarcode(db, copyBarcode);

      expect(result.loan.returnedAt).not.toBeNull();
      expect(result.wasOverdue).toBe(false);
      // The result names the borrower, so the screen can show who brought it back.
      expect(result.loan.studentLastName).toBe('כהן');
      expect(listLoans(db, { status: 'active' }).total).toBe(0);
    });

    it('refuses a copy that is not on loan', () => {
      expectDomainError(() => checkinByBarcode(db, copyBarcode), 'NOT_ON_LOAN');
    });

    it('refuses an unknown barcode', () => {
      expectDomainError(() => checkinByBarcode(db, '999999'), 'COPY_NOT_FOUND');
    });

    it('reports a late return as overdue', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      db.prepare('UPDATE loans SET due_at = ? WHERE public_id = ?').run(
        addDays(new Date().toISOString(), -3),
        loan.publicId,
      );

      const result = checkinByBarcode(db, copyBarcode);
      expect(result.wasOverdue).toBe(true);
    });

    it('never deletes a returned loan (§7)', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      checkinByBarcode(db, copyBarcode);

      expect(getLoan(db, loan.publicId).returnedAt).not.toBeNull();
      expect(listLoans(db, { status: 'returned' }).total).toBe(1);
    });

    it('writes an audit entry for the return', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      checkinByBarcode(db, copyBarcode);

      const actions = listAudit(db, { entityId: loan.publicId }).map((entry) => entry.action);
      expect(actions).toContain('loan.returned');
      expect(actions).toContain('loan.checked_out');
    });
  });

  describe('renewal', () => {
    it('extends the due date and counts the renewal', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      const renewed = renewLoan(db, loan.publicId, { extraDays: 7 });

      expect(renewed.renewalCount).toBe(1);
      expect(Date.parse(renewed.dueAt!)).toBeGreaterThan(Date.parse(loan.dueAt!));
    });

    it('renews an overdue loan from today, not from the date already passed', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      db.prepare('UPDATE loans SET due_at = ? WHERE public_id = ?').run(
        addDays(new Date().toISOString(), -10),
        loan.publicId,
      );

      const renewed = renewLoan(db, loan.publicId, { extraDays: 7 });

      expect(renewed.overdue).toBe(false);
      expect(Date.parse(renewed.dueAt!)).toBeGreaterThan(Date.now());
    });

    it('refuses to renew a loan that was already returned', () => {
      const loan = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      checkinByBarcode(db, copyBarcode);

      expectDomainError(() => renewLoan(db, loan.publicId), 'LOAN_ALREADY_RETURNED');
    });
  });

  describe('overdue and the student card', () => {
    it('lists only open loans past their due date', () => {
      const book = createBook(db, { title: 'ספר' });
      createCopy(db, { bookPublicId: book.publicId, barcode: 'C1' });

      const late = checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      checkoutCopy(db, { barcode: 'C1', studentPublicId: studentId });
      db.prepare('UPDATE loans SET due_at = ? WHERE public_id = ?').run(
        addDays(new Date().toISOString(), -5),
        late.publicId,
      );

      const overdue = listLoans(db, { status: 'overdue' });
      expect(overdue.total).toBe(1);
      expect(overdue.items[0]?.barcode).toBe('001796');
      expect(overdue.items[0]?.daysOverdue).toBe(5);

      // A returned book is never overdue, however late it was.
      checkinByBarcode(db, copyBarcode);
      expect(listLoans(db, { status: 'overdue' }).total).toBe(0);
    });

    it('summarises a student for the card and the future integration endpoint', () => {
      const book = createBook(db, { title: 'ספר' });
      createCopy(db, { bookPublicId: book.publicId, barcode: 'E1' });

      checkoutCopy(db, { barcode: copyBarcode, studentPublicId: studentId });
      checkoutCopy(db, { barcode: 'E1', studentPublicId: studentId });
      checkinByBarcode(db, 'E1');

      const summary = getStudentLibrarySummary(db, studentId);

      expect(summary.student.lastName).toBe('כהן');
      expect(summary.activeLoanCount).toBe(1);
      expect(summary.overdueCount).toBe(0);
      expect(summary.lifetimeLoanCount).toBe(2);
      expect(summary.activeLoans[0]?.barcode).toBe('001796');
      expect(summary.lastActivityAt).not.toBeNull();
    });

    it('counts a student with no history as empty rather than failing', () => {
      const summary = getStudentLibrarySummary(db, otherStudentId);

      expect(summary.activeLoanCount).toBe(0);
      expect(summary.lifetimeLoanCount).toBe(0);
      expect(summary.lastActivityAt).toBeNull();
    });
  });
});
