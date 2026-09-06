import ExcelJS from 'exceljs';
import iconv from 'iconv-lite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DomainError,
  commitImportBatch,
  createImportBatch,
  createStudent,
  decodeText,
  listBooks,
  listCategories,
  listClasses,
  listCopies,
  listImportRows,
  listShelves,
  listStudents,
  migrations,
  openDatabase,
  parseCsvBuffer,
  parseFile,
  runMigrations,
  suggestMapping,
  validateImportBatch,
  type ColumnMapping,
  type Db,
  type ImportType,
  type ParsedSheet,
} from '../src/index.js';

function csv(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

/** Stages a sheet and validates it with the mapping the headers suggest. */
function stageAndValidate(db: Db, sheet: ParsedSheet, importType: ImportType, override?: ColumnMapping) {
  const batch = createImportBatch(db, { filename: 'test.csv', importType, sheet });
  const mapping = override ?? suggestMapping(sheet.headers, importType);
  return { batch: validateImportBatch(db, batch.publicId, mapping), publicId: batch.publicId };
}

describe('parsing', () => {
  it('reads a UTF-8 CSV with Hebrew headers', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה,כיתה\nשרה,כהן,ז-1\n'));

    expect(sheet.headers).toEqual(['שם פרטי', 'שם משפחה', 'כיתה']);
    expect(sheet.rows).toEqual([['שרה', 'כהן', 'ז-1']]);
    expect(sheet.encoding).toBe('utf-8');
  });

  it('reads a CSV saved by Hebrew Excel as windows-1255', () => {
    // Excel on a Hebrew Windows writes this encoding by default, and reading
    // it as UTF-8 turns every name into replacement characters.
    const buffer = iconv.encode('שם פרטי,שם משפחה\nשרה,כהן\n', 'windows-1255');
    const sheet = parseCsvBuffer(buffer);

    expect(sheet.encoding).toBe('windows-1255');
    expect(sheet.headers).toEqual(['שם פרטי', 'שם משפחה']);
    expect(sheet.rows[0]).toEqual(['שרה', 'כהן']);
  });

  it('strips a UTF-8 byte order mark', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('a,b\n1,2\n', 'utf8')]);
    expect(decodeText(buffer).text.startsWith('a,b')).toBe(true);
    expect(parseCsvBuffer(buffer).headers).toEqual(['a', 'b']);
  });

  it('keeps a barcode as text, with its leading zeros', () => {
    const sheet = parseCsvBuffer(csv('שם הספר,ברקוד\nמסילת ישרים,0000123\n'));
    expect(sheet.rows[0]?.[1]).toBe('0000123');
  });

  it('handles quoted fields containing commas', () => {
    const sheet = parseCsvBuffer(csv('שם הספר,מחבר\n"ישרים, מסילת",רמחל\n'));
    expect(sheet.rows[0]).toEqual(['ישרים, מסילת', 'רמחל']);
  });

  it('reads an xlsx file, including a barcode stored as text', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('קטלוג');
    sheet.addRow(['שם הספר', 'מחבר', 'ברקוד']);
    sheet.addRow(['מסילת ישרים', 'רמחל', '0000123']);
    sheet.addRow(['שערי תשובה', 'רבנו יונה', '001797']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseFile('catalog.xlsx', buffer);

    expect(parsed.format).toBe('xlsx');
    expect(parsed.headers).toEqual(['שם הספר', 'מחבר', 'ברקוד']);
    expect(parsed.rows[0]?.[2]).toBe('0000123');
    expect(parsed.rows).toHaveLength(2);
  });

  it('rejects a file type it cannot read', async () => {
    await expect(parseFile('catalog.pdf', Buffer.from('x'))).rejects.toThrowError(DomainError);
  });

  it('names unnamed columns rather than losing them', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,,כיתה\nשרה,x,ז-1\n'));
    expect(sheet.headers[1]).toBe('עמודה 2');
  });
});

describe('column mapping suggestions', () => {
  it('maps Hebrew headers a school export actually uses', () => {
    const mapping = suggestMapping(['שם פרטי', 'שם משפחה', 'כיתה', 'ברקוד כרטיס'], 'students');

    expect(mapping.firstName).toBe(0);
    expect(mapping.lastName).toBe(1);
    expect(mapping.className).toBe(2);
    expect(mapping.localBarcode).toBe(3);
  });

  it('maps English headers too', () => {
    const mapping = suggestMapping(['First Name', 'Last Name', 'Class'], 'students');
    expect(mapping).toMatchObject({ firstName: 0, lastName: 1, className: 2 });
  });

  it('never assigns one column to two fields', () => {
    const mapping = suggestMapping(['ברקוד', 'שם הספר'], 'books');
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('leaves a field unmapped when nothing matches', () => {
    const mapping = suggestMapping(['col1', 'col2'], 'students');
    expect(mapping.firstName).toBeUndefined();
  });

  /**
   * Taken from a real catalogue export, which is where this was found.
   *
   * `IN_TITLE_no` is a record number and comes first; `TI_TITLE` is the book's
   * title. Both contain "title", and taking the first match meant proposing
   * that a column of numbers was the name of every book — a catalogue that
   * would have to be thrown away and imported again.
   */
  it('proposes the closest header, not the first one that happens to contain the word', () => {
    const mapping = suggestMapping(
      ['IN_TITLE_no', 'TITLE_No_LUZI', 'TI_TITLE', 'A1_AUTHORS', 'PB_Publisher'],
      'books',
    );

    expect(mapping.title).toBe(2);
    expect(mapping.authorText).toBe(3);
    expect(mapping.publisher).toBe(4);
  });

  it('still prefers a header that is exactly the field name', () => {
    // The first column merely contains the word and comes first; the second is
    // the field's own name. An exact match is decided before any partial one,
    // so closeness never gets to overrule it.
    const mapping = suggestMapping(['ברקוד_ישן_מהמערכת', 'ברקוד', 'שם הספר'], 'books');

    expect(mapping.barcode).toBe(1);
    expect(mapping.title).toBe(2);
  });

  it('does not invent a mapping for a column that only shares a stray word', () => {
    const mapping = suggestMapping(['IN_TITLE_no', 'A1_AUTHORS'], 'books');

    // Nothing here is a book title, but a record number is the least wrong
    // guess available, so it is proposed and the librarian corrects it. What
    // matters is that a better column, when present, wins.
    expect(mapping.authorText).toBe(1);
  });
});

describe('importing students', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('imports students and creates the classes they belong to', () => {
    const sheet = parseCsvBuffer(
      csv('שם פרטי,שם משפחה,כיתה\nשרה,כהן,ז-1\nיוסי,מזרחי,ז-1\nרונית,אברהם,ח-2\n'),
    );
    const { publicId, batch } = stageAndValidate(db, sheet, 'students');

    expect(batch.totalRows).toBe(3);
    expect(batch.successCount).toBe(3);
    expect(batch.errorCount).toBe(0);

    const report = commitImportBatch(db, publicId);

    expect(report.imported).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.createdClasses.sort()).toEqual(['ז-1', 'ח-2']);
    expect(listStudents(db).total).toBe(3);
    // One class per distinct name, not one per row.
    expect(listClasses(db).total).toBe(2);
  });

  it('reports a missing required value instead of importing the row', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה\nשרה,כהן\n,לוי\nדוד,\n'));
    const { publicId, batch } = stageAndValidate(db, sheet, 'students');

    expect(batch.successCount).toBe(1);
    expect(batch.errorCount).toBe(2);

    const rows = listImportRows(db, publicId, { status: 'error' });
    expect(rows.items[0]?.problems).toContain('חסר שם פרטי');
    expect(rows.items[1]?.problems).toContain('חסר שם משפחה');

    expect(commitImportBatch(db, publicId).imported).toBe(1);
    expect(listStudents(db).total).toBe(1);
  });

  it('skips blank rows without calling them errors', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה\nשרה,כהן\n,\n\nיוסי,לוי\n'));
    const { publicId, batch } = stageAndValidate(db, sheet, 'students');

    expect(batch.successCount).toBe(2);
    expect(batch.errorCount).toBe(0);
    expect(listImportRows(db, publicId, { status: 'skipped' }).total).toBeGreaterThan(0);
  });

  it('catches a barcode duplicated inside the file', () => {
    const sheet = parseCsvBuffer(
      csv('שם פרטי,שם משפחה,ברקוד כרטיס\nשרה,כהן,00042\nיוסי,לוי,00042\n'),
    );
    const { publicId, batch } = stageAndValidate(db, sheet, 'students');

    expect(batch.errorCount).toBe(1);
    const problems = listImportRows(db, publicId, { status: 'error' }).items[0]?.problems ?? [];
    expect(problems.join(' ')).toContain('שורה 1');

    commitImportBatch(db, publicId);
    expect(listStudents(db).total).toBe(1);
  });

  it('catches a barcode that already belongs to a student', () => {
    createStudent(db, { firstName: 'קיים', lastName: 'תלמיד', localBarcode: '00042' });

    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה,ברקוד כרטיס\nשרה,כהן,00042\n'));
    const { publicId, batch } = stageAndValidate(db, sheet, 'students');

    expect(batch.errorCount).toBe(1);
    expect(listImportRows(db, publicId, { status: 'error' }).items[0]?.problems.join(' ')).toContain(
      'כבר משויך',
    );
  });

  it('warns about an ambiguous name rather than blocking it', () => {
    createStudent(db, { firstName: 'שרה', lastName: 'כהן' });

    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה\nשרה,כהן\n'));
    const { publicId, batch } = stageAndValidate(db, sheet, 'students');

    expect(batch.warningCount).toBe(1);
    expect(batch.errorCount).toBe(0);

    // A warning still imports: two children can share a name.
    expect(commitImportBatch(db, publicId).imported).toBe(1);
    expect(listStudents(db).total).toBe(2);
  });

  it('preserves a card barcode exactly, leading zeros and all', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה,ברקוד כרטיס\nשרה,כהן,0000042\n'));
    const { publicId } = stageAndValidate(db, sheet, 'students');
    commitImportBatch(db, publicId);

    expect(listStudents(db).items[0]?.localBarcode).toBe('0000042');
  });

  it('refuses to validate without a mapping for a required field', () => {
    const sheet = parseCsvBuffer(csv('a,b\n1,2\n'));
    const batch = createImportBatch(db, { filename: 'x.csv', importType: 'students', sheet });

    expect(() => validateImportBatch(db, batch.publicId, { lastName: 1 })).toThrowError(DomainError);
  });

  it('refuses to commit before validation', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה\nשרה,כהן\n'));
    const batch = createImportBatch(db, { filename: 'x.csv', importType: 'students', sheet });

    expect(() => commitImportBatch(db, batch.publicId)).toThrowError(DomainError);
  });

  it('refuses to commit the same batch twice', () => {
    const sheet = parseCsvBuffer(csv('שם פרטי,שם משפחה\nשרה,כהן\n'));
    const { publicId } = stageAndValidate(db, sheet, 'students');

    commitImportBatch(db, publicId);
    expect(() => commitImportBatch(db, publicId)).toThrowError(DomainError);
    expect(listStudents(db).total).toBe(1);
  });
});

describe('importing books', () => {
  let db: Db;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
  });

  afterEach(() => {
    db.close();
  });

  it('keeps several copies of one title as one book (§6)', () => {
    const sheet = parseCsvBuffer(
      csv(
        'שם הספר,מחבר,ברקוד\n' +
          'מסילת ישרים,רמחל,001796\n' +
          'מסילת ישרים,רמחל,001797\n' +
          'מסילת ישרים,רמחל,001798\n' +
          'שערי תשובה,רבנו יונה,002001\n',
      ),
    );
    const { publicId } = stageAndValidate(db, sheet, 'books');
    const report = commitImportBatch(db, publicId);

    expect(report.imported).toBe(4);
    expect(listBooks(db).total).toBe(2);
    expect(listCopies(db).total).toBe(4);
    expect(listBooks(db).items.find((book) => book.title === 'מסילת ישרים')?.copyCount).toBe(3);
  });

  it('creates categories and shelf locations named in the file', () => {
    const sheet = parseCsvBuffer(
      csv(
        'שם הספר,ברקוד,קטגוריה,מדף\n' +
          'ספר מתח,001,מתח,מדף 3\n' +
          'ספר קומיקס,002,קומיקס,מדף 4\n' +
          'עוד מתח,003,מתח,מדף 3\n',
      ),
    );
    const { publicId } = stageAndValidate(db, sheet, 'books');
    const report = commitImportBatch(db, publicId);

    expect(report.createdCategories.sort()).toEqual(['מתח', 'קומיקס']);
    expect(report.createdShelves.sort()).toEqual(['מדף 3', 'מדף 4']);
    expect(listCategories(db)).toHaveLength(2);
    expect(listShelves(db)).toHaveLength(2);
  });

  it('preserves a copy barcode exactly', () => {
    const sheet = parseCsvBuffer(csv('שם הספר,ברקוד\nמסילת ישרים,0000123\n'));
    const { publicId } = stageAndValidate(db, sheet, 'books');
    commitImportBatch(db, publicId);

    expect(listCopies(db).items[0]?.barcode).toBe('0000123');
  });

  it('catches a barcode that already exists in the catalogue', () => {
    const first = parseCsvBuffer(csv('שם הספר,ברקוד\nמסילת ישרים,001796\n'));
    const staged = stageAndValidate(db, first, 'books');
    commitImportBatch(db, staged.publicId);

    const second = parseCsvBuffer(csv('שם הספר,ברקוד\nספר אחר,001796\n'));
    const { publicId, batch } = stageAndValidate(db, second, 'books');

    expect(batch.errorCount).toBe(1);
    expect(listImportRows(db, publicId, { status: 'error' }).items[0]?.problems.join(' ')).toContain(
      'כבר קיים',
    );

    commitImportBatch(db, publicId);
    expect(listCopies(db).total).toBe(1);
  });

  it('warns, but still imports, a title with no barcode', () => {
    const sheet = parseCsvBuffer(csv('שם הספר,מחבר\nספר בלי ברקוד,מחבר כלשהו\n'));
    const { publicId, batch } = stageAndValidate(db, sheet, 'books');

    expect(batch.warningCount).toBe(1);
    expect(commitImportBatch(db, publicId).imported).toBe(1);
    expect(listBooks(db).total).toBe(1);
    expect(listCopies(db).total).toBe(0);
  });

  it('normalises a hyphenated ISBN and ignores an invalid one', () => {
    const sheet = parseCsvBuffer(
      csv('שם הספר,ברקוד,מסתב\nספר תקין,001,978-965-7141-23-4\nספר פגום,002,12345\n'),
    );
    const { publicId, batch } = stageAndValidate(db, sheet, 'books');

    expect(batch.warningCount).toBe(1);
    commitImportBatch(db, publicId);

    const books = listBooks(db).items;
    expect(books.find((book) => book.title === 'ספר תקין')?.isbn13).toBe('9789657141234');
    expect(books.find((book) => book.title === 'ספר פגום')?.isbn13).toBeNull();
  });

  it('matches an existing title by ISBN rather than creating a second one', () => {
    const first = parseCsvBuffer(csv('שם הספר,ברקוד,מסתב\nמסילת ישרים,001,9789657141234\n'));
    const staged = stageAndValidate(db, first, 'books');
    commitImportBatch(db, staged.publicId);

    // Same edition, differently spelled title.
    const second = parseCsvBuffer(csv('שם הספר,ברקוד,מסתב\nמסילת-ישרים,002,978-965-7141-23-4\n'));
    const { publicId } = stageAndValidate(db, second, 'books');
    commitImportBatch(db, publicId);

    expect(listBooks(db).total).toBe(1);
    expect(listCopies(db).total).toBe(2);
  });

  it('nothing reaches the catalogue before commit', () => {
    const sheet = parseCsvBuffer(csv('שם הספר,ברקוד\nמסילת ישרים,001796\n'));
    stageAndValidate(db, sheet, 'books');

    expect(listBooks(db).total).toBe(0);
    expect(listCopies(db).total).toBe(0);
  });
});
