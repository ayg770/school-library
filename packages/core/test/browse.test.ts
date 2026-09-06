import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkoutCopy,
  createCategory,
  createClass,
  createShelf,
  createStudent,
  getCatalogueBreakdown,
  intakeCopy,
  listBooks,
  migrations,
  openDatabase,
  runMigrations,
  type Db,
} from '../src/index.js';

describe('browsing the catalogue by subject and by shelf', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('counts an empty library as empty rather than failing', () => {
    const breakdown = getCatalogueBreakdown(db);

    expect(breakdown.categories).toEqual([]);
    expect(breakdown.shelves).toEqual([]);
    expect(breakdown.uncategorisedTitles).toBe(0);
    expect(breakdown.unplacedCopies).toBe(0);
  });

  it('lists a category that has nothing in it yet', () => {
    createCategory(db, { name: 'קומיקס' });

    const [comics] = getCatalogueBreakdown(db).categories;
    expect(comics?.name).toBe('קומיקס');
    expect(comics?.titles).toBe(0);
    expect(comics?.copies).toBe(0);
  });

  it('counts titles and copies separately (§6)', () => {
    const thriller = createCategory(db, { name: 'מתח' });

    // One title, three copies.
    for (const barcode of ['1', '2', '3']) {
      intakeCopy(db, {
        barcode,
        title: 'רצח בכיתה ג',
        authorText: 'מחבר',
        categoryPublicId: thriller.publicId,
      });
    }
    // A second title in the same category.
    intakeCopy(db, { barcode: '4', title: 'תעלומה', categoryPublicId: thriller.publicId });

    const [category] = getCatalogueBreakdown(db).categories;
    expect(category?.titles).toBe(2);
    expect(category?.copies).toBe(4);
  });

  it('keeps two categories apart rather than summing them', () => {
    const comics = createCategory(db, { name: 'קומיקס' });
    const young = createCategory(db, { name: 'צעירים' });

    intakeCopy(db, { barcode: '1', title: 'קומיקס א', categoryPublicId: comics.publicId });
    intakeCopy(db, { barcode: '2', title: 'קומיקס ב', categoryPublicId: comics.publicId });
    intakeCopy(db, { barcode: '3', title: 'צעירים א', categoryPublicId: young.publicId });

    const byName = new Map(
      getCatalogueBreakdown(db).categories.map((category) => [category.name, category]),
    );
    expect(byName.get('קומיקס')?.titles).toBe(2);
    expect(byName.get('צעירים')?.titles).toBe(1);
  });

  it('counts what an import failed to place, which is the point of the screen', () => {
    createCategory(db, { name: 'מתח' });
    createShelf(db, { name: 'מדף 1' });

    intakeCopy(db, { barcode: '1', title: 'בלי קטגוריה ובלי מדף' });
    intakeCopy(db, { barcode: '2', title: 'גם זה' });

    const breakdown = getCatalogueBreakdown(db);
    expect(breakdown.uncategorisedTitles).toBe(2);
    expect(breakdown.unplacedCopies).toBe(2);
  });

  it('reports how many of a shelf are out on loan, so the count matches the shelf', () => {
    const shelf = createShelf(db, { name: 'מדף 3', room: 'ספרייה' });
    const schoolClass = createClass(db, { name: 'ג1' });
    const student = createStudent(db, {
      firstName: 'דנה',
      lastName: 'כהן',
      classPublicId: schoolClass.publicId,
    });

    const first = intakeCopy(db, { barcode: '1', title: 'ספר א', shelfPublicId: shelf.publicId });
    intakeCopy(db, { barcode: '2', title: 'ספר ב', shelfPublicId: shelf.publicId });

    checkoutCopy(db, { studentPublicId: student.publicId, barcode: first.copy.barcode });

    const [row] = getCatalogueBreakdown(db).shelves;
    expect(row?.name).toBe('מדף 3');
    expect(row?.room).toBe('ספרייה');
    expect(row?.copies).toBe(2);
    expect(row?.onLoan).toBe(1);
  });

  it('finds the titles on one shelf', () => {
    const one = createShelf(db, { name: 'מדף 1' });
    const two = createShelf(db, { name: 'מדף 2' });

    intakeCopy(db, { barcode: '1', title: 'על מדף 1', shelfPublicId: one.publicId });
    intakeCopy(db, { barcode: '2', title: 'על מדף 2', shelfPublicId: two.publicId });
    intakeCopy(db, { barcode: '3', title: 'בלי מדף' });

    const onShelfOne = listBooks(db, { shelfPublicId: one.publicId });
    expect(onShelfOne.total).toBe(1);
    expect(onShelfOne.items[0]?.title).toBe('על מדף 1');
  });

  it('lists a title once when several of its copies share a shelf', () => {
    const shelf = createShelf(db, { name: 'מדף 1' });

    intakeCopy(db, { barcode: '1', title: 'ספר', authorText: 'מחבר', shelfPublicId: shelf.publicId });
    intakeCopy(db, { barcode: '2', title: 'ספר', authorText: 'מחבר', shelfPublicId: shelf.publicId });

    // Two copies of one book is one book (§6) — a join would have said two.
    const result = listBooks(db, { shelfPublicId: shelf.publicId });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('finds a title whose other copy is elsewhere', () => {
    const one = createShelf(db, { name: 'מדף 1' });
    const two = createShelf(db, { name: 'מדף 2' });

    intakeCopy(db, { barcode: '1', title: 'ספר', authorText: 'מחבר', shelfPublicId: one.publicId });
    intakeCopy(db, { barcode: '2', title: 'ספר', authorText: 'מחבר', shelfPublicId: two.publicId });

    expect(listBooks(db, { shelfPublicId: one.publicId }).total).toBe(1);
    expect(listBooks(db, { shelfPublicId: two.publicId }).total).toBe(1);
  });

  it('combines a shelf with a category, rather than choosing one', () => {
    const shelf = createShelf(db, { name: 'מדף 1' });
    const comics = createCategory(db, { name: 'קומיקס' });

    intakeCopy(db, {
      barcode: '1',
      title: 'קומיקס על המדף',
      shelfPublicId: shelf.publicId,
      categoryPublicId: comics.publicId,
    });
    intakeCopy(db, { barcode: '2', title: 'לא קומיקס, על המדף', shelfPublicId: shelf.publicId });
    intakeCopy(db, { barcode: '3', title: 'קומיקס, לא על המדף', categoryPublicId: comics.publicId });

    const result = listBooks(db, {
      shelfPublicId: shelf.publicId,
      categoryPublicId: comics.publicId,
    });

    expect(result.total).toBe(1);
    expect(result.items[0]?.title).toBe('קומיקס על המדף');
  });

  it('narrows a search by shelf rather than ignoring one of them', () => {
    const shelf = createShelf(db, { name: 'מדף 1' });

    intakeCopy(db, { barcode: '1', title: 'מסילת ישרים', shelfPublicId: shelf.publicId });
    intakeCopy(db, { barcode: '2', title: 'מסילת ישרים אחר' });

    expect(listBooks(db, { query: 'מסילת', shelfPublicId: shelf.publicId }).total).toBe(1);
  });
});
