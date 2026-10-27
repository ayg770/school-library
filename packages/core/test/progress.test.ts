import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkinByBarcode,
  checkoutCopy,
  createBook,
  createClass,
  createCopy,
  createStaffUser,
  createStudent,
  finishRound,
  intakeCopy,
  listProgress,
  migrations,
  openDatabase,
  rankFor,
  recordScan,
  reportMismatch,
  runMigrations,
  staffRowId,
  startRound,
  type Db,
} from '../src/index.js';

/**
 * What each librarian has done.
 *
 * The volunteers take turns at one desk, so "who did this" is a question that
 * gets asked — and a morning of counting leaves nothing on the shelves to
 * show for itself. These tests hold the two things that makes necessary: the
 * work is recorded against the person who did it, and it survives the round
 * it was done in.
 */
describe('a librarian’s own tally', () => {
  let db: Db;
  let mendy: string;
  let shneur: string;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);

    mendy = createStaffUser(db, {
      username: 'mendy',
      password: '12345678',
      displayName: 'מנדי כהן',
    }).publicId;
    shneur = createStaffUser(db, {
      username: 'shneur',
      password: '87654321',
      displayName: 'שניאור לוי',
    }).publicId;

    const book = createBook(db, { title: 'מעשה באווז' });
    for (const barcode of ['001', '002', '003']) {
      createCopy(db, { bookPublicId: book.publicId, barcode });
    }
  });

  afterEach(() => db.close());

  const of = (publicId: string) =>
    listProgress(db).find((person) => person.userPublicId === publicId)!;

  it('counts a book against the person who scanned it', () => {
    startRound(db, 'תשפ״ז');
    recordScan(db, { barcode: '001', userPublicId: mendy });
    recordScan(db, { barcode: '002', userPublicId: mendy });
    recordScan(db, { barcode: '003', userPublicId: shneur });

    expect(of(mendy).counts['copy.counted']).toBe(2);
    expect(of(shneur).counts['copy.counted']).toBe(1);
  });

  it('does not pay twice for the same book in one round', () => {
    startRound(db, 'תשפ״ז');
    recordScan(db, { barcode: '001', userPublicId: mendy });
    recordScan(db, { barcode: '001', userPublicId: mendy });

    // The work is the books found, not the scans made.
    expect(of(mendy).counts['copy.counted']).toBe(1);
  });

  it('keeps the work after the round that it was done in', () => {
    startRound(db, 'תשפ״ז');
    recordScan(db, { barcode: '001', userPublicId: mendy });

    // The copy itself remembers only the latest round and the latest hands,
    // so a second round would otherwise erase the first morning entirely.
    finishRound(db);
    startRound(db, 'תשפ״ח');
    recordScan(db, { barcode: '001', userPublicId: shneur });

    expect(of(mendy).counts['copy.counted']).toBe(1);
    expect(of(shneur).counts['copy.counted']).toBe(1);
  });

  it('counts lending, returning, cataloguing and reporting', () => {
    const klass = createClass(db, { name: 'ג׳1' });
    const student = createStudent(db, {
      firstName: 'לוי',
      lastName: 'יצחק',
      classPublicId: klass.publicId,
    });

    checkoutCopy(db, {
      barcode: '001',
      studentPublicId: student.publicId,
      staffUserId: staffRowId(db, mendy),
    });
    checkinByBarcode(db, '001', staffRowId(db, mendy));
    intakeCopy(db, { barcode: '900', title: 'ספר חדש', userPublicId: mendy });
    reportMismatch(db, { barcode: '002', userPublicId: mendy });

    const tally = of(mendy);
    expect(tally.counts['loan.checked_out']).toBe(1);
    expect(tally.counts['loan.returned']).toBe(1);
    expect(tally.counts['copy.added']).toBe(1);
    expect(tally.counts['report.filed']).toBe(1);
    expect(tally.total).toBe(4);
  });

  it('lists everyone, including the volunteer whose first morning it is', () => {
    expect(listProgress(db).map((person) => person.displayName).sort()).toEqual([
      'מנדי כהן',
      'שניאור לוי',
    ]);
    expect(of(shneur).total).toBe(0);
    expect(of(shneur).rank.level).toBe(1);
  });

  it('climbs the ladder, and says how far the next rung is', () => {
    expect(rankFor(0).level).toBe(1);
    expect(rankFor(25).title).toBe('עוזר ספרן');
    expect(rankFor(1500).title).toBe('אלוף הספרייה');

    const start = of(mendy);
    expect(start.nextRank?.from).toBe(25);
    expect(start.toNextRank).toBe(25);
  });

  it('has nothing to say about the top of the ladder beyond it', () => {
    const top = rankFor(99999);
    expect(top.title).toBe('אלוף הספרייה');
  });
});
