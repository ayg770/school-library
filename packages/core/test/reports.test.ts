import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBook,
  createCopy,
  createStaffUser,
  listReports,
  migrations,
  openDatabase,
  openReportCount,
  reportMismatch,
  resolveReport,
  runMigrations,
  updateBook,
  type Db,
} from '../src/index.js';

/**
 * "This is not that book."
 *
 * The librarian is holding a book, a scanner, and a queue of children. These
 * tests exist to keep that person moving: one press, and the disagreement is
 * somebody else's problem later.
 */
describe('disagreements between the sticker and the catalogue', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);

    const book = createBook(db, { title: 'מסילת ישרים', authorText: 'רמח"ל' });
    createCopy(db, { bookPublicId: book.publicId, barcode: '001796' });
  });

  afterEach(() => {
    db.close();
  });

  it('records what the catalogue claimed, so the evidence survives the fix', () => {
    const report = reportMismatch(db, { barcode: '001796', actualTitle: 'שערי תשובה' });

    expect(report.barcode).toBe('001796');
    expect(report.claimedTitle).toBe('מסילת ישרים');
    expect(report.actualTitle).toBe('שערי תשובה');
    expect(report.resolvedAt).toBeNull();
  });

  it('keeps the claim even after the catalogue is corrected', () => {
    reportMismatch(db, { barcode: '001796' });

    const book = db.prepare('SELECT public_id FROM books').get() as { public_id: string };
    updateBook(db, book.public_id, { title: 'שערי תשובה' });

    // The whole point of the report is to cause this change. If the change
    // erased what was reported, nobody could ever check the correction.
    expect(listReports(db).items[0]!.claimedTitle).toBe('מסילת ישרים');
  });

  it('does not file the same disagreement twice', () => {
    reportMismatch(db, { barcode: '001796' });
    reportMismatch(db, { barcode: '001796', note: 'שוב' });

    // Pressing again because nothing visibly happened is not an error.
    expect(listReports(db).total).toBe(1);
    expect(listReports(db).items[0]!.note).toBe('שוב');
  });

  it('accepts a barcode the catalogue has never heard of', () => {
    // A sticker with no entry at all is exactly the case worth reporting.
    const report = reportMismatch(db, { barcode: '999999' });

    expect(report.barcode).toBe('999999');
    expect(report.claimedTitle).toBeNull();
  });

  it('names who reported it', () => {
    const tali = createStaffUser(db, {
      username: 'tali',
      password: 'a-good-password',
      displayName: 'טלי',
    });

    const report = reportMismatch(db, { barcode: '001796', userPublicId: tali.publicId });
    expect(report.reportedBy).toBe('טלי');
  });

  it('counts what is still waiting, and stops counting once settled', () => {
    reportMismatch(db, { barcode: '001796' });
    reportMismatch(db, { barcode: '999999' });
    expect(openReportCount(db)).toBe(2);

    const open = listReports(db, { resolved: false }).items;
    resolveReport(db, open[0]!.publicId, 'הודבקה מדבקה חדשה');

    expect(openReportCount(db)).toBe(1);
    expect(listReports(db, { resolved: true }).items[0]!.resolution).toBe('הודבקה מדבקה חדשה');
  });

  it('allows the same barcode to be reported again after the first was settled', () => {
    const first = reportMismatch(db, { barcode: '001796' });
    resolveReport(db, first.publicId, 'תוקן');

    // The sticker went wrong again, or the fix did not work. Either way the
    // librarian must be able to say so.
    const second = reportMismatch(db, { barcode: '001796' });

    expect(second.publicId).not.toBe(first.publicId);
    expect(listReports(db).total).toBe(2);
    expect(openReportCount(db)).toBe(1);
  });

  it('refuses a kind it does not recognise', () => {
    expect(() => reportMismatch(db, { barcode: '001796', kind: 'nonsense' })).toThrow(
      /סוג הדיווח אינו תקין/,
    );
  });

  it('settling something already settled changes nothing', () => {
    const report = reportMismatch(db, { barcode: '001796' });
    const settled = resolveReport(db, report.publicId, 'תוקן');
    const again = resolveReport(db, report.publicId, 'תוקן שוב');

    expect(again.resolvedAt).toBe(settled.resolvedAt);
    expect(again.resolution).toBe('תוקן');
  });
});
