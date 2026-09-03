import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DomainError,
  createBook,
  createCategory,
  createClass,
  createCopy,
  createShelf,
  createStudent,
  findCopyByBarcode,
  findStudentByBarcode,
  getBook,
  listBooks,
  listCopies,
  listStudents,
  migrations,
  openDatabase,
  runMigrations,
  updateBook,
  updateCategory,
  updateCopy,
  updateStudent,
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

describe('catalog', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  describe('classes and students', () => {
    it('creates a student in a class', () => {
      const schoolClass = createClass(db, { name: 'ז-1', grade: 'ז', section: '1' });
      const student = createStudent(db, {
        firstName: 'שרה',
        lastName: 'כהן',
        classPublicId: schoolClass.publicId,
      });

      expect(student.firstName).toBe('שרה');
      expect(student.className).toBe('ז-1');
      expect(student.active).toBe(true);
    });

    it('rejects a class that does not exist', () => {
      expectDomainError(
        () => createStudent(db, { firstName: 'א', lastName: 'ב', classPublicId: 'no-such-class' }),
        'REFERENCE_NOT_FOUND',
      );
    });

    it('requires a first and last name', () => {
      expectDomainError(() => createStudent(db, { firstName: '', lastName: 'כהן' }), 'VALIDATION');
      expectDomainError(() => createStudent(db, { firstName: 'שרה', lastName: '   ' }), 'VALIDATION');
    });

    it('deactivates rather than deletes a student (§7)', () => {
      const student = createStudent(db, { firstName: 'דוד', lastName: 'לוי' });
      const updated = updateStudent(db, student.publicId, { active: false });

      expect(updated.active).toBe(false);
      // The row survives, so a loan can still name whose it was.
      expect(listStudents(db, { active: false }).total).toBe(1);
      expect(listStudents(db, { active: true }).total).toBe(0);
    });

    it('keeps a student card barcode unique', () => {
      createStudent(db, { firstName: 'א', lastName: 'א', localBarcode: '00123' });
      expectDomainError(
        () => createStudent(db, { firstName: 'ב', lastName: 'ב', localBarcode: '00123' }),
        'DUPLICATE_BARCODE',
      );
    });

    it('finds a student by an exact card barcode', () => {
      createStudent(db, { firstName: 'מרים', lastName: 'פרץ', localBarcode: '00042' });

      expect(findStudentByBarcode(db, '00042')?.firstName).toBe('מרים');
      // Not a prefix, not a suffix, not a trimmed variant.
      expect(findStudentByBarcode(db, '42')).toBeNull();
      expect(findStudentByBarcode(db, ' 00042')).toBeNull();
    });

    it('searches by name fragment and by exact barcode', () => {
      const klass = createClass(db, { name: 'ח-2' });
      createStudent(db, { firstName: 'יוסי', lastName: 'מזרחי', classPublicId: klass.publicId });
      createStudent(db, { firstName: 'רונית', lastName: 'אברהם', localBarcode: '77' });

      expect(listStudents(db, { query: 'מזרח' }).total).toBe(1);
      expect(listStudents(db, { query: 'יוסי מזרחי' }).total).toBe(1);
      expect(listStudents(db, { query: '77' }).total).toBe(1);
      expect(listStudents(db, { classPublicId: klass.publicId }).total).toBe(1);
    });

    it('moves a student between classes', () => {
      const from = createClass(db, { name: 'ז-1' });
      const to = createClass(db, { name: 'ח-1' });
      const student = createStudent(db, { firstName: 'א', lastName: 'ב', classPublicId: from.publicId });

      const moved = updateStudent(db, student.publicId, { classPublicId: to.publicId });
      expect(moved.className).toBe('ח-1');
    });
  });

  describe('books and copies', () => {
    it('separates a title from its physical copies (§6)', () => {
      const book = createBook(db, { title: 'מסילת ישרים', authorText: 'רמח"ל' });
      for (const barcode of ['001796', '001797', '001798']) {
        createCopy(db, { bookPublicId: book.publicId, barcode });
      }

      expect(getBook(db, book.publicId).copyCount).toBe(3);
      expect(listBooks(db).total).toBe(1);
      expect(listCopies(db, { bookPublicId: book.publicId }).total).toBe(3);
    });

    it('preserves leading zeros in a barcode', () => {
      const book = createBook(db, { title: 'ספר' });
      const copy = createCopy(db, { bookPublicId: book.publicId, barcode: '0000123' });

      expect(copy.barcode).toBe('0000123');
      expect(findCopyByBarcode(db, '0000123')?.publicId).toBe(copy.publicId);
      expect(findCopyByBarcode(db, '123')).toBeNull();
    });

    it('rejects a barcode containing whitespace rather than trimming it (§34)', () => {
      const book = createBook(db, { title: 'ספר' });

      expectDomainError(() => createCopy(db, { bookPublicId: book.publicId, barcode: ' 123' }), 'VALIDATION');
      expectDomainError(() => createCopy(db, { bookPublicId: book.publicId, barcode: '123\r' }), 'VALIDATION');
      expectDomainError(() => createCopy(db, { bookPublicId: book.publicId, barcode: '' }), 'VALIDATION');
    });

    it('refuses two copies with the same barcode', () => {
      const first = createBook(db, { title: 'ספר א' });
      const second = createBook(db, { title: 'ספר ב' });
      createCopy(db, { bookPublicId: first.publicId, barcode: '555' });

      expectDomainError(
        () => createCopy(db, { bookPublicId: second.publicId, barcode: '555' }),
        'DUPLICATE_BARCODE',
        'across different books',
      );
    });

    it('allows a barcode to be reused once the original copy changes it', () => {
      const book = createBook(db, { title: 'ספר' });
      const copy = createCopy(db, { bookPublicId: book.publicId, barcode: '900' });

      updateCopy(db, copy.publicId, { barcode: '901' });
      const replacement = createCopy(db, { bookPublicId: book.publicId, barcode: '900' });

      expect(replacement.barcode).toBe('900');
      expect(findCopyByBarcode(db, '901')?.publicId).toBe(copy.publicId);
    });

    it('requires a book for every copy', () => {
      expectDomainError(() => createCopy(db, { bookPublicId: '', barcode: '1' }), 'VALIDATION');
      expectDomainError(() => createCopy(db, { bookPublicId: 'missing', barcode: '1' }), 'REFERENCE_NOT_FOUND');
    });

    it('normalises an ISBN but rejects one of the wrong length', () => {
      const book = createBook(db, { title: 'ספר', isbn13: '978-965-7141-23-4' });
      expect(book.isbn13).toBe('9789657141234');

      expectDomainError(() => createBook(db, { title: 'אחר', isbn13: '12345' }), 'VALIDATION');
      expect(createBook(db, { title: 'עוד', isbn10: '965-7141-23-X' }).isbn10).toBe('965714123X');
    });

    it('validates the condition of a copy', () => {
      const book = createBook(db, { title: 'ספר' });
      const copy = createCopy(db, { bookPublicId: book.publicId, barcode: '1', conditionStatus: 'damaged' });
      expect(copy.conditionStatus).toBe('damaged');

      expectDomainError(
        () => createCopy(db, { bookPublicId: book.publicId, barcode: '2', conditionStatus: 'broken' }),
        'VALIDATION',
      );
    });

    it('rejects a negative or fractional price', () => {
      const book = createBook(db, { title: 'ספר' });
      expectDomainError(
        () => createCopy(db, { bookPublicId: book.publicId, barcode: '1', priceCents: -100 }),
        'VALIDATION',
      );
      expectDomainError(
        () => createCopy(db, { bookPublicId: book.publicId, barcode: '2', priceCents: 12.5 }),
        'VALIDATION',
      );
    });

    it('searches titles by fragment and identifiers exactly', () => {
      const book = createBook(db, { title: 'מסילת ישרים', authorText: 'רמח"ל', isbn13: '9789657141234' });
      createCopy(db, { bookPublicId: book.publicId, barcode: '001796' });
      createBook(db, { title: 'שערי תשובה' });

      expect(listBooks(db, { query: 'מסילת' }).total).toBe(1);
      expect(listBooks(db, { query: 'רמח' }).total).toBe(1);
      expect(listBooks(db, { query: '978-965-7141-23-4' }).total).toBe(1);
      expect(listBooks(db, { query: '001796' }).total).toBe(1);
      expect(listBooks(db, { query: '1796' }).total).toBe(0);
      expect(listBooks(db).total).toBe(2);
    });

    it('treats % and _ in a search as literal characters', () => {
      createBook(db, { title: '100% כשר' });
      createBook(db, { title: 'ספר אחר' });

      expect(listBooks(db, { query: '100%' }).total).toBe(1);
      expect(listBooks(db, { query: '%' }).total).toBe(1);
    });

    it('paginates and reports the full total', () => {
      for (let index = 0; index < 12; index += 1) {
        createBook(db, { title: `ספר ${String(index).padStart(2, '0')}` });
      }

      const page = listBooks(db, { limit: 5, offset: 5 });
      expect(page.items).toHaveLength(5);
      expect(page.total).toBe(12);
      expect(page.items[0]?.title).toBe('ספר 05');
    });

    it('deactivates a book without touching its copies', () => {
      const book = createBook(db, { title: 'ספר' });
      createCopy(db, { bookPublicId: book.publicId, barcode: '1' });

      updateBook(db, book.publicId, { active: false });

      expect(listBooks(db, { active: false }).total).toBe(1);
      expect(listCopies(db, { bookPublicId: book.publicId }).total).toBe(1);
    });
  });

  describe('categories and shelves', () => {
    it('nests categories', () => {
      const parent = createCategory(db, { name: 'הלכה' });
      const child = createCategory(db, { name: 'שבת', parentPublicId: parent.publicId });

      expect(child.parentPublicId).toBe(parent.publicId);
    });

    it('refuses a category cycle', () => {
      const parent = createCategory(db, { name: 'הלכה' });
      const child = createCategory(db, { name: 'שבת', parentPublicId: parent.publicId });

      expectDomainError(
        () => updateCategory(db, parent.publicId, { parentPublicId: child.publicId }),
        'INVALID_PARENT',
        'parent moved under its own child',
      );
      expectDomainError(
        () => updateCategory(db, parent.publicId, { parentPublicId: parent.publicId }),
        'INVALID_PARENT',
        'category as its own parent',
      );
    });

    it('places a copy on a shelf', () => {
      const shelf = createShelf(db, { name: 'מדף 3', room: 'ספרייה', shelfCode: 'A3' });
      const book = createBook(db, { title: 'ספר' });
      const copy = createCopy(db, {
        bookPublicId: book.publicId,
        barcode: '1',
        shelfPublicId: shelf.publicId,
      });

      expect(copy.shelfName).toBe('מדף 3');
      expect(listCopies(db, { shelfPublicId: shelf.publicId }).total).toBe(1);
    });

    it('links a book to a category and filters by it', () => {
      const category = createCategory(db, { name: 'מוסר' });
      createBook(db, { title: 'מסילת ישרים', categoryPublicId: category.publicId });
      createBook(db, { title: 'ספר ללא קטגוריה' });

      expect(listBooks(db, { categoryPublicId: category.publicId }).total).toBe(1);
      expect(getBook(db, listBooks(db, { categoryPublicId: category.publicId }).items[0]!.publicId).categoryName).toBe(
        'מוסר',
      );
    });
  });
});
