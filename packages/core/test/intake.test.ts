import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DomainError,
  createBook,
  createCategory,
  createShelf,
  getDashboardSummary,
  intakeCopy,
  listBooks,
  listCopies,
  migrations,
  openDatabase,
  runMigrations,
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

describe('shelf intake', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('creates the title and its first copy in one step', () => {
    const result = intakeCopy(db, {
      barcode: '0001001',
      title: 'מסילת ישרים',
      authorText: 'רמחל',
    });

    expect(result.createdTitle).toBe(true);
    expect(result.book.title).toBe('מסילת ישרים');
    expect(result.copy.barcode).toBe('0001001');
    expect(listBooks(db).total).toBe(1);
    expect(listCopies(db).total).toBe(1);
  });

  it('adds a second copy to an existing title rather than a second book (§6)', () => {
    intakeCopy(db, { barcode: '0001001', title: 'מסילת ישרים', authorText: 'רמחל' });
    const second = intakeCopy(db, { barcode: '0001002', title: 'מסילת ישרים', authorText: 'רמחל' });

    expect(second.createdTitle).toBe(false);
    expect(second.book.publicId).toBe(listBooks(db).items[0]?.publicId);
    expect(listBooks(db).total).toBe(1);
    expect(listCopies(db).total).toBe(2);
    expect(second.book.copyCount).toBe(2);
  });

  it('treats the same title by a different author as a different book', () => {
    intakeCopy(db, { barcode: 'A1', title: 'שירים', authorText: 'מחבר א' });
    const other = intakeCopy(db, { barcode: 'A2', title: 'שירים', authorText: 'מחבר ב' });

    expect(other.createdTitle).toBe(true);
    expect(listBooks(db).total).toBe(2);
  });

  it('matches an existing title by ISBN even when the title is spelled differently', () => {
    intakeCopy(db, { barcode: 'B1', title: 'מסילת ישרים', isbn13: '9789657141234' });
    const second = intakeCopy(db, {
      barcode: 'B2',
      title: 'מסילת-ישרים',
      isbn13: '978-965-7141-23-4',
    });

    expect(second.createdTitle).toBe(false);
    expect(listBooks(db).total).toBe(1);
    expect(listCopies(db).total).toBe(2);
  });

  it('preserves a barcode exactly, leading zeros and all', () => {
    const result = intakeCopy(db, { barcode: '0000123', title: 'ספר' });

    expect(result.copy.barcode).toBe('0000123');
    expect(listCopies(db).items[0]?.barcode).toBe('0000123');
  });

  it('refuses a barcode already in the catalogue, and names what it is', () => {
    intakeCopy(db, { barcode: '0001001', title: 'מסילת ישרים' });

    try {
      intakeCopy(db, { barcode: '0001001', title: 'ספר אחר' });
      expect.unreachable('expected the duplicate to be refused');
    } catch (error) {
      expect((error as DomainError).code).toBe('DUPLICATE_BARCODE');
      expect((error as DomainError).message).toContain('מסילת ישרים');
    }
  });

  it('leaves no stray title behind when the barcode is refused', () => {
    intakeCopy(db, { barcode: '0001001', title: 'מסילת ישרים' });
    expect(() => intakeCopy(db, { barcode: '0001001', title: 'ספר חדש לגמרי' })).toThrow();

    // The refused title must not have been created on the way to failing.
    expect(listBooks(db).items.map((book) => book.title)).toEqual(['מסילת ישרים']);
  });

  it('rejects a barcode containing whitespace rather than trimming it (§34)', () => {
    expectDomainError(() => intakeCopy(db, { barcode: ' 123', title: 'ספר' }), 'VALIDATION');
    expectDomainError(() => intakeCopy(db, { barcode: '12 3', title: 'ספר' }), 'VALIDATION');
  });

  it('requires a title', () => {
    expectDomainError(() => intakeCopy(db, { barcode: '1', title: '' }), 'VALIDATION');
  });

  it('rejects a malformed ISBN instead of storing it', () => {
    expectDomainError(() => intakeCopy(db, { barcode: '1', title: 'ספר', isbn13: '12345' }), 'VALIDATION');
    expect(listBooks(db).total).toBe(0);
  });

  it('places the copy on a shelf and the title in a category', () => {
    const category = createCategory(db, { name: 'מתח' });
    const shelf = createShelf(db, { name: 'מדף 3' });

    const result = intakeCopy(db, {
      barcode: '1',
      title: 'ספר מתח',
      categoryPublicId: category.publicId,
      shelfPublicId: shelf.publicId,
    });

    expect(result.book.categoryName).toBe('מתח');
    expect(result.copy.shelfName).toBe('מדף 3');
  });

  it('joins a title that was created some other way', () => {
    const existing = createBook(db, { title: 'ספר קיים', authorText: 'מחבר' });
    const result = intakeCopy(db, { barcode: '1', title: 'ספר קיים', authorText: 'מחבר' });

    expect(result.createdTitle).toBe(false);
    expect(result.book.publicId).toBe(existing.publicId);
  });
});

describe('the home screen figures', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('counts an empty library as empty rather than failing', () => {
    const summary = getDashboardSummary(db);

    expect(summary.activeLoans).toBe(0);
    expect(summary.overdue).toBe(0);
    expect(summary.titles).toBe(0);
    expect(summary.copies).toBe(0);
    expect(summary.copiesOnShelf).toBe(0);
  });

  it('derives what is on the shelf from what is not on loan', () => {
    for (const barcode of ['1', '2', '3']) {
      intakeCopy(db, { barcode, title: `ספר ${barcode}` });
    }

    const before = getDashboardSummary(db);
    expect(before.copies).toBe(3);
    expect(before.copiesOnShelf).toBe(3);
    expect(before.titles).toBe(3);
  });
});
