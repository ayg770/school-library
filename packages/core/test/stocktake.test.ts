import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkoutCopy,
  createBook,
  createClass,
  createCopy,
  createStaffUser,
  createStudent,
  currentRound,
  finishRound,
  listMissing,
  listRounds,
  migrations,
  openDatabase,
  recordScan,
  runMigrations,
  startRound,
  stocktakeProgress,
  updateCopy,
  type Db,
} from '../src/index.js';

/**
 * Walking the shelves with a scanner.
 *
 * The library holds 2,212 copies according to a spreadsheet and nobody has
 * checked. These tests describe the walk that settles it, and they are written
 * around the one thing that decides whether it gets done at all: a book that
 * is present and fine has to cost a single scan.
 */

function shelfOf(db: Db, barcodes: readonly string[]): void {
  const book = createBook(db, { title: 'מסילת ישרים', authorText: 'רמח"ל' });
  for (const barcode of barcodes) {
    createCopy(db, { bookPublicId: book.publicId, barcode });
  }
}

describe('counting the shelves', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
    shelfOf(db, ['001', '002', '003']);
  });

  afterEach(() => {
    db.close();
  });

  describe('a round', () => {
    it('starts, and refuses to start a second one on top of it', () => {
      const round = startRound(db, 'תשפ״ז');

      expect(round.name).toBe('תשפ״ז');
      expect(round.finishedAt).toBeNull();
      expect(currentRound(db)?.publicId).toBe(round.publicId);

      // Two open rounds would be two answers to "how many are left".
      expect(() => startRound(db, 'עוד אחד')).toThrow(/כבר פתוח סבב/);
    });

    it('lets the next one begin once the first is finished', () => {
      startRound(db, 'ראשון');
      finishRound(db);

      expect(currentRound(db)).toBeNull();
      startRound(db, 'שני');

      expect(listRounds(db).map((r) => r.name)).toEqual(['שני', 'ראשון']);
    });

    it('will not count before a round is open', () => {
      expect(() => recordScan(db, { barcode: '001' })).toThrow(/אין סבב בדיקה פתוח/);
    });
  });

  describe('one scan, one book', () => {
    beforeEach(() => {
      startRound(db, 'תשפ״ז');
    });

    it('counts a book as present and fine, with nothing else said', () => {
      const result = recordScan(db, { barcode: '001' });

      expect(result.found).toBe(true);
      expect(result.copy?.bookTitle).toBe('מסילת ישרים');
      expect(result.copy?.conditionStatus).toBe('normal');
      expect(result.copy?.verifiedAt).not.toBeNull();
      expect(result.repeat).toBe(false);

      expect(stocktakeProgress(db).seen).toBe(1);
    });

    it('takes a condition when the librarian says one', () => {
      recordScan(db, { barcode: '002', conditionStatus: 'repair', conditionNote: 'הכריכה קרועה' });

      const progress = stocktakeProgress(db);
      expect(progress.byCondition.repair).toBe(1);
      expect(progress.byCondition.normal).toBe(0);
      expect(progress.seen).toBe(1);
    });

    it('rejects a condition it does not recognise, rather than storing it', () => {
      expect(() => recordScan(db, { barcode: '001', conditionStatus: 'bent' })).toThrow(
        /מצב הספר אינו תקין/,
      );
    });

    it('says when a book has already been counted in this round', () => {
      recordScan(db, { barcode: '001' });
      const second = recordScan(db, { barcode: '001' });

      // Scanning the same shelf twice is a normal mistake on a long morning.
      // It must not inflate the count, and the librarian should be told.
      expect(second.repeat).toBe(true);
      expect(stocktakeProgress(db).seen).toBe(1);
    });

    it('reports a barcode the catalogue does not know, and invents nothing', () => {
      const result = recordScan(db, { barcode: '999' });

      expect(result.found).toBe(false);
      expect(result.copy).toBeNull();
      // Adding a book needs a title and an author. A scanner has neither.
      expect(stocktakeProgress(db).seen).toBe(0);
    });

    it('records who was holding the scanner', () => {
      const tali = createStaffUser(db, {
        username: 'tali',
        password: 'a-good-password',
        displayName: 'טלי',
      });

      recordScan(db, { barcode: '001', userPublicId: tali.publicId });

      const row = db
        .prepare(
          `SELECT u.username FROM book_copies bc
             JOIN staff_users u ON u.id = bc.verified_by_user_id
            WHERE bc.barcode = ?`,
        )
        .get('001') as { username: string } | undefined;
      expect(row?.username).toBe('tali');
    });

    it('refuses to credit a sighting to an account that does not exist', () => {
      // The volunteers' progression will be built on these rows, so a count
      // credited to nobody is worse than one with no name on it at all. Said
      // in a sentence here, rather than as a foreign key error from below.
      expect(() => recordScan(db, { barcode: '001', userPublicId: 'no-such-user' })).toThrow(
        /המשתמש שנבחר לא נמצא/,
      );
    });
  });

  describe('what is still outstanding', () => {
    beforeEach(() => {
      startRound(db, 'תשפ״ז');
    });

    it('counts three expected, one seen, two still to find', () => {
      recordScan(db, { barcode: '002' });

      const progress = stocktakeProgress(db);
      expect(progress.expected).toBe(3);
      expect(progress.seen).toBe(1);
      expect(progress.missing).toBe(2);

      expect(listMissing(db).items.map((c) => c.barcode).sort()).toEqual(['001', '003']);
    });

    it('does not expect a copy that was withdrawn', () => {
      const copies = db.prepare('SELECT public_id FROM book_copies WHERE barcode = ?').get('003') as {
        public_id: string;
      };
      updateCopy(db, copies.public_id, { conditionStatus: 'withdrawn' });

      // A total that can never be reached is a progress bar nobody trusts.
      expect(stocktakeProgress(db).expected).toBe(2);
      expect(listMissing(db).items.map((c) => c.barcode)).not.toContain('003');
    });

    it('names the child holding a book rather than calling it lost', () => {
      const klass = createClass(db, { name: 'ח-2' });
      const student = createStudent(db, {
        firstName: 'יוסי',
        lastName: 'מזרחי',
        classPublicId: klass.publicId,
      });
      checkoutCopy(db, { barcode: '001', studentPublicId: student.publicId });

      const missing = listMissing(db).items.find((c) => c.barcode === '001');

      // Most of what a first count cannot find is in a schoolbag. A list that
      // does not say so sends someone searching a shelf for nothing.
      expect(missing?.onLoanTo).toBe('יוסי מזרחי');
    });

    it('still knows a borrowed book is present when it is scanned on return', () => {
      const student = createStudent(db, { firstName: 'רונית', lastName: 'אברהם' });
      checkoutCopy(db, { barcode: '002', studentPublicId: student.publicId });

      const result = recordScan(db, { barcode: '002' });
      expect(result.onLoanTo).toBe('רונית אברהם');
      expect(stocktakeProgress(db).seen).toBe(1);
    });
  });

  describe('a round is a line in time, not a flag', () => {
    it('ignores a copy last seen before this round began', () => {
      startRound(db, 'ישן');
      recordScan(db, { barcode: '001' });
      finishRound(db);

      startRound(db, 'חדש');

      // Evidence from last year is not evidence about this year's shelves.
      const progress = stocktakeProgress(db);
      expect(progress.seen).toBe(0);
      expect(progress.missing).toBe(3);
      expect(listMissing(db).items.find((c) => c.barcode === '001')?.lastSeen).not.toBeNull();
    });

    it('reports nothing outstanding while no round is open', () => {
      expect(stocktakeProgress(db).round).toBeNull();
      expect(listMissing(db).items).toEqual([]);
    });

    it('expects a book catalogued mid-count to be found like any other', () => {
      startRound(db, 'תשפ״ז');
      const book = createBook(db, { title: 'ספר חדש' });
      createCopy(db, { bookPublicId: book.publicId, barcode: '004' });

      // A book entered from the box in front of the librarian still has to be
      // scanned onto the shelf, so it joins the total and the outstanding list.
      expect(stocktakeProgress(db).expected).toBe(4);
      expect(listMissing(db).items.map((c) => c.barcode)).toContain('004');

      recordScan(db, { barcode: '004' });
      expect(stocktakeProgress(db).seen).toBe(1);
    });
  });
});
