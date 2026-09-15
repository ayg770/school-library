import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyTable,
  checkoutCopy,
  confirmOfficeLoans,
  createBook,
  createCategory,
  createCopy,
  createStudent,
  listBooks,
  migrations,
  openDatabase,
  pushTable,
  rowsToPush,
  runMigrations,
  runSync,
  signIn,
  syncStatus,
  updateBook,
  writeSetting,
  writeSyncState,
  type Db,
  type PullTable,
  type PushTable,
  type RemoteLibrary,
  type RemoteRow,
} from '../src/index.js';

/**
 * An online library that is not online.
 *
 * Every rule about what to do with a row is decided on this side, so all of it
 * can be tested against a stand-in. Only the transport needs a network, and
 * the transport decides nothing.
 */
class FakeRemote implements RemoteLibrary {
  readonly tables = new Map<PullTable, RemoteRow[]>();
  /** Everything this stand-in was asked to store, in the order it arrived. */
  readonly written = new Map<PushTable, RemoteRow[]>();
  /** Rows the stand-in refuses, by public id, to stand for a database saying no. */
  reject = new Set<string>();
  failWholeBatch = false;

  put(table: PullTable, ...rows: RemoteRow[]): void {
    this.tables.set(table, [...(this.tables.get(table) ?? []), ...rows]);
  }

  received(table: PushTable = 'loans'): RemoteRow[] {
    return this.written.get(table) ?? [];
  }

  async fetchSince(table: PullTable, since: string | null): Promise<RemoteRow[]> {
    const rows = this.tables.get(table) ?? [];
    if (since === null) return rows;
    return rows.filter((row) => String(row.updated_at) >= since);
  }

  async upsert(table: PushTable, rows: readonly RemoteRow[]): Promise<void> {
    if (this.failWholeBatch && rows.length > 1) throw new Error('batch rejected');
    for (const row of rows) {
      if (this.reject.has(String(row.public_id))) {
        throw new Error('insert or update violates foreign key constraint "loans_student_id_fkey"');
      }
    }
    this.written.set(table, [...this.received(table), ...rows]);
  }

  async describeAccount(): Promise<{ email: string; displayName: string; role: string }> {
    return { email: 'library@example.test', displayName: 'מחשב הספרייה', role: 'librarian' };
  }
}

const AT = '2026-09-15T08:00:00.000Z';

function remoteCatalogue(remote: FakeRemote): void {
  remote.put('categories', {
    public_id: 'cat-1',
    name: 'עלילה',
    parent_id: null,
    active: true,
    created_at: AT,
    updated_at: AT,
  });
  remote.put('classes', {
    public_id: 'class-1',
    name: 'ז-1',
    external_class_id: null,
    grade: null,
    section: null,
    academic_year: null,
    active: true,
    created_at: AT,
    updated_at: AT,
  });
  remote.put('books', {
    public_id: 'book-1',
    title: 'מסילת ישרים',
    author_text: 'רמח"ל',
    category_id: 'cat-1',
    active: true,
    created_at: AT,
    updated_at: AT,
  });
  remote.put('students', {
    public_id: 'student-1',
    first_name: 'שרה',
    last_name: 'כהן',
    class_id: 'class-1',
    local_barcode: 'S-1',
    active: true,
    created_at: AT,
    updated_at: AT,
  });
  remote.put('book_copies', {
    public_id: 'copy-1',
    book_id: 'book-1',
    barcode: '001796',
    condition_status: 'normal',
    active: true,
    created_at: AT,
    updated_at: AT,
  });
}

describe('sync', () => {
  let db: Db;
  let remote: FakeRemote;

  beforeEach(() => {
    db = openDatabase({ file: ':memory:' });
    runMigrations(db, migrations);
    remote = new FakeRemote();
  });

  afterEach(() => {
    db.close();
  });

  describe('downloading what the office decided', () => {
    it('brings the catalogue down with its references intact', async () => {
      remoteCatalogue(remote);
      const report = await runSync(db, remote);

      const books = listBooks(db, { query: 'מסילת' });
      expect(books.items).toHaveLength(1);
      expect(books.items[0]!.publicId).toBe('book-1');
      expect(books.items[0]!.categoryName).toBe('עלילה');

      const copy = db.prepare('SELECT barcode, book_id FROM book_copies').get() as {
        barcode: string;
        book_id: number;
      };
      expect(copy.barcode).toBe('001796');

      const bookRow = db.prepare('SELECT id FROM books WHERE public_id = ?').get('book-1') as {
        id: number;
      };
      expect(copy.book_id).toBe(bookRow.id);
      expect(report.pulled.find((t) => t.table === 'books')?.added).toBe(1);
    });

    it('applies the same download twice without duplicating anything', async () => {
      remoteCatalogue(remote);
      await runSync(db, remote);
      writeSyncState(db, { lastPulledAt: null });
      await runSync(db, remote);

      const counts = db
        .prepare(
          'SELECT (SELECT COUNT(*) FROM books) AS books, (SELECT COUNT(*) FROM book_copies) AS copies',
        )
        .get() as { books: number; copies: number };
      expect(counts).toEqual({ books: 1, copies: 1 });
    });

    it('lets a locally imported copy adopt the online id, keeping one row per barcode', () => {
      const book = createBook(db, { title: 'מסילת ישרים', authorText: 'רמח"ל' });
      const local = createCopy(db, { bookPublicId: book.publicId, barcode: '001796' });
      expect(local.publicId).not.toBe('copy-1');

      applyTable(db, 'books', [
        { public_id: 'book-1', title: 'מסילת ישרים', author_text: 'רמח"ל', active: true, updated_at: AT },
      ]);
      applyTable(db, 'book_copies', [
        {
          public_id: 'copy-1',
          book_id: 'book-1',
          barcode: '001796',
          condition_status: 'normal',
          active: true,
          updated_at: AT,
        },
      ]);

      const rows = db.prepare('SELECT public_id FROM book_copies').all() as Array<{
        public_id: string;
      }>;
      expect(rows).toEqual([{ public_id: 'copy-1' }]);
    });

    it('reports a reference it could not resolve instead of inventing one', () => {
      const outcome = applyTable(db, 'books', [
        { public_id: 'book-9', title: 'ספר', category_id: 'cat-missing', active: true, updated_at: AT },
      ]);

      expect(outcome.result.added).toBe(1);
      expect(outcome.problems).toHaveLength(1);
      expect(outcome.problems[0]!.what).toBe('ספר');
      expect(outcome.problems[0]!.why).toContain('category_id');
    });
  });

  describe('accounts', () => {
    it('brings an account down without a password, and refuses to sign it in', async () => {
      remote.put('staff_users', {
        public_id: 'staff-1',
        username: 'rivka',
        display_name: 'רבקה',
        role: 'librarian',
        email: 'rivka@example.test',
        active: true,
        created_at: AT,
        updated_at: AT,
      });
      await runSync(db, remote);

      const row = db.prepare('SELECT username, password_hash FROM staff_users').get() as {
        username: string;
        password_hash: string;
      };
      expect(row.username).toBe('rivka');
      expect(() => signIn(db, 'rivka', row.password_hash)).toThrow();
      expect(() => signIn(db, 'rivka', 'anything-at-all')).toThrow();
      expect(syncStatus(db).accountsWithoutPassword).toBe(1);
    });

    it('matches an account already set up here by its username, keeping its password', async () => {
      db.prepare(
        `INSERT INTO staff_users (public_id, username, password_hash, display_name, role, active, created_at, updated_at)
         VALUES ('local-1', 'rivka', 'kept-hash', 'רבקה', 'librarian', 1, ?, ?)`,
      ).run(AT, AT);

      applyTable(db, 'staff_users', [
        {
          public_id: 'staff-1',
          username: 'rivka',
          display_name: 'רבקה כהן',
          role: 'admin',
          email: 'rivka@example.test',
          active: true,
          updated_at: AT,
        },
      ]);

      const rows = db.prepare('SELECT public_id, password_hash, display_name, role FROM staff_users').all();
      expect(rows).toEqual([
        { public_id: 'staff-1', password_hash: 'kept-hash', display_name: 'רבקה כהן', role: 'admin' },
      ]);
    });
  });

  describe('a checkout proposed from the office', () => {
    beforeEach(async () => {
      remoteCatalogue(remote);
      await runSync(db, remote);
    });

    function proposeLoan(publicId = 'loan-office'): void {
      remote.put('loans', {
        public_id: publicId,
        copy_id: 'copy-1',
        student_id: 'student-1',
        checkout_at: AT,
        due_at: null,
        returned_at: null,
        checkout_by: null,
        return_by: null,
        renewal_count: 0,
        notes: null,
        origin: 'office',
        confirmed_at: null,
        created_at: AT,
        updated_at: AT,
      });
    }

    it('becomes a real loan once this computer has seen it', async () => {
      proposeLoan();
      const report = await runSync(db, remote);

      expect(report.confirmed).toBe(1);
      const loan = db.prepare('SELECT origin, confirmed_at FROM loans').get() as {
        origin: string;
        confirmed_at: string | null;
      };
      expect(loan.origin).toBe('office');
      expect(loan.confirmed_at).not.toBeNull();
    });

    it('keeps waiting when a librarian already lent that copy from the desk', async () => {
      const student = createStudent(db, { firstName: 'יוסי', lastName: 'מזרחי' });
      checkoutCopy(db, { barcode: '001796', studentPublicId: student.publicId });

      proposeLoan();
      const report = await runSync(db, remote);

      expect(report.confirmed).toBe(0);
      expect(report.stillPending).toBe(1);
      expect(report.problems.some((p) => p.why.includes('כבר מושאל'))).toBe(true);

      const pending = db
        .prepare("SELECT confirmed_at FROM loans WHERE origin = 'office'")
        .get() as { confirmed_at: string | null };
      expect(pending.confirmed_at).toBeNull();
    });

    it('is not sent back up while it is still only a suggestion', async () => {
      const student = createStudent(db, { firstName: 'יוסי', lastName: 'מזרחי' });
      checkoutCopy(db, { barcode: '001796', studentPublicId: student.publicId });
      proposeLoan();
      await runSync(db, remote);

      expect(remote.received().some((loan) => loan.public_id === 'loan-office')).toBe(false);
    });
  });

  describe('sending circulation up', () => {
    beforeEach(async () => {
      remoteCatalogue(remote);
      await runSync(db, remote);
    });

    it('sends a loan made at the desk, then stops resending it', async () => {
      checkoutCopy(db, { barcode: '001796', studentPublicId: 'student-1' });

      const first = await runSync(db, remote);
      expect(first.pushed).toBe(1);
      expect(remote.received()[0]!.copy_id).toBe('copy-1');
      expect(remote.received()[0]!.student_id).toBe('student-1');
      expect(remote.received()[0]!.origin).toBe('library');
      expect(remote.received()[0]!.confirmed_at).not.toBeNull();

      const second = await runSync(db, remote);
      expect(second.pushed).toBe(0);
      expect(remote.received()).toHaveLength(1);
    });

    it('isolates the one loan the online library refuses, and sends the rest', async () => {
      const otherBook = createBook(db, { title: 'ספר שני' });
      createCopy(db, { bookPublicId: otherBook.publicId, barcode: '002' });
      const localStudent = createStudent(db, { firstName: 'דוד', lastName: 'לוי' });

      checkoutCopy(db, { barcode: '001796', studentPublicId: 'student-1' });
      const rejected = checkoutCopy(db, { barcode: '002', studentPublicId: localStudent.publicId });

      remote.failWholeBatch = true;
      remote.reject.add(rejected.publicId);

      const report = await runSync(db, remote);

      expect(report.pushed).toBe(1);
      expect(report.problems).toHaveLength(1);
      // Named by the book and the child, because "a row was refused" is not
      // something anybody can act on.
      expect(report.problems[0]!.what).toBe('ספר שני — דוד לוי');
      expect(report.problems[0]!.why).toContain('עדיין לא קיים באונליין');
      expect(remote.received().map((l) => l.copy_id)).toEqual(['copy-1']);
    });

    it('does not mark a refused loan as sent, so the next exchange tries again', async () => {
      const otherBook = createBook(db, { title: 'ספר שני' });
      createCopy(db, { bookPublicId: otherBook.publicId, barcode: '002' });
      const localStudent = createStudent(db, { firstName: 'דוד', lastName: 'לוי' });
      const rejected = checkoutCopy(db, { barcode: '002', studentPublicId: localStudent.publicId });

      remote.failWholeBatch = true;
      remote.reject.add(rejected.publicId);
      await runSync(db, remote);

      const still = rowsToPush(db, 'loans');
      expect(still.map((row) => row.publicId)).toEqual([rejected.publicId]);

      const row = db
        .prepare('SELECT synced_at FROM loans WHERE public_id = ?')
        .get(rejected.publicId) as { synced_at: string | null };
      expect(row.synced_at).toBeNull();
    });

    it('sends a return, because the return changed the loan', async () => {
      checkoutCopy(db, { barcode: '001796', studentPublicId: 'student-1' });
      await runSync(db, remote);
      remote.written.clear();

      db.prepare(
        "UPDATE loans SET returned_at = '2026-09-16T00:00:00.000Z', updated_at = '2026-09-16T00:00:00.000Z'",
      ).run();

      const report = await runSync(db, remote);
      expect(report.pushed).toBe(1);
      expect(remote.received()[0]!.returned_at).toBe('2026-09-16T00:00:00.000Z');
    });
  });

  describe('what the sync screen shows', () => {
    it('starts disconnected, with nothing waiting', () => {
      const status = syncStatus(db);
      expect(status.connected).toBe(false);
      expect(status.lastPulledAt).toBeNull();
      expect(status.waitingToSend).toBe(0);
      expect(status.waitingSuggestions).toBe(0);
    });

    it('counts a suggestion that is still waiting', async () => {
      remoteCatalogue(remote);
      await runSync(db, remote);
      const student = createStudent(db, { firstName: 'יוסי', lastName: 'מזרחי' });
      checkoutCopy(db, { barcode: '001796', studentPublicId: student.publicId });

      remote.put('loans', {
        public_id: 'loan-office',
        copy_id: 'copy-1',
        student_id: 'student-1',
        checkout_at: AT,
        renewal_count: 0,
        origin: 'office',
        confirmed_at: null,
        returned_at: null,
        due_at: null,
        notes: null,
        checkout_by: null,
        return_by: null,
        created_at: AT,
        updated_at: AT,
      });
      await runSync(db, remote);

      expect(syncStatus(db).waitingSuggestions).toBe(1);
    });
  });

  describe('the shelf decides, not the office', () => {
    it('never lets a suggestion and a real loan hold the same copy', async () => {
      remoteCatalogue(remote);
      await runSync(db, remote);

      const student = createStudent(db, { firstName: 'יוסי', lastName: 'מזרחי' });
      checkoutCopy(db, { barcode: '001796', studentPublicId: student.publicId });

      const copy = db.prepare("SELECT id FROM book_copies WHERE barcode = '001796'").get() as {
        id: number;
      };
      const studentRow = db.prepare("SELECT id FROM students WHERE public_id = 'student-1'").get() as {
        id: number;
      };

      // A suggestion may sit alongside the real loan …
      db.prepare(
        `INSERT INTO loans (public_id, copy_id, student_id, checkout_at, origin, confirmed_at, created_at, updated_at)
         VALUES ('loan-office', ?, ?, ?, 'office', NULL, ?, ?)`,
      ).run(copy.id, studentRow.id, AT, AT, AT);

      // … but confirming it would put two real loans on one book, and the
      // database refuses that whatever the application does.
      expect(() =>
        db.prepare("UPDATE loans SET confirmed_at = ? WHERE public_id = 'loan-office'").run(AT),
      ).toThrow();

      const decided = confirmOfficeLoans(db);
      expect(decided.confirmed).toBe(0);
      expect(decided.stillPending).toBe(1);
    });
  });

  describe('the two sides spell a timestamp differently', () => {
    it('stores what Postgres sent in this database\u2019s own spelling', () => {
      applyTable(db, 'categories', [
        {
          public_id: 'cat-1',
          name: 'עלילה',
          active: true,
          created_at: '2026-09-14T21:02:33.123456+00:00',
          updated_at: '2026-09-14T21:02:33.123456+00:00',
        },
      ]);

      const row = db.prepare('SELECT created_at, updated_at FROM categories').get() as {
        created_at: string;
        updated_at: string;
      };
      expect(row.updated_at).toBe('2026-09-14T21:02:33.123Z');
      expect(row.created_at).toBe('2026-09-14T21:02:33.123Z');
    });

    it('does not offer a Postgres-stamped row back up for ever', () => {
      // The same instant in the two spellings. As text they do not compare the
      // way the clock does — which is exactly how a row that had just arrived
      // could look newer than its own mark and be sent straight back, over and
      // over, every time the two sides spoke.
      const postgres = '2026-09-15T08:00:00.000000+00:00';
      const ours = '2026-09-15T08:00:00.000Z';
      expect(postgres > ours).toBe(false);
      expect(ours > postgres).toBe(true);

      applyTable(db, 'books', [
        { public_id: 'book-7', title: 'ספר מהמשרד', active: true, created_at: postgres, updated_at: postgres },
      ]);

      const row = db.prepare('SELECT updated_at, synced_at FROM books').get() as {
        updated_at: string;
        synced_at: string;
      };
      expect(row.updated_at).toBe(ours);
      expect(row.synced_at).toBe(ours);
      expect(rowsToPush(db, 'books')).toHaveLength(0);
    });
  });

  describe('pushTable', () => {
    it('sends nothing, and asks for nothing, when there is nothing to send', async () => {
      const outcome = await pushTable(remote, 'loans', []);
      expect(outcome).toEqual({ sent: 0, problems: [], accepted: [] });
      expect(remote.received()).toHaveLength(0);
    });
  });

  describe('a book catalogued at the desk', () => {
    beforeEach(async () => {
      remoteCatalogue(remote);
      await runSync(db, remote);
      remote.written.clear();
    });

    it('goes up, with its copy, and stops going up after that', async () => {
      const book = createBook(db, { title: 'ספר חדש מהקופסה', authorText: 'מישהו' });
      createCopy(db, { bookPublicId: book.publicId, barcode: '9001' });

      const first = await runSync(db, remote);
      expect(first.sent.find((t) => t.table === 'books')?.sent).toBe(1);
      expect(first.sent.find((t) => t.table === 'book_copies')?.sent).toBe(1);
      expect(remote.received('books')[0]!.title).toBe('ספר חדש מהקופסה');
      expect(remote.received('book_copies')[0]!.barcode).toBe('9001');
      // The copy points at the book by the id both sides share.
      expect(remote.received('book_copies')[0]!.book_id).toBe(book.publicId);

      remote.written.clear();
      const second = await runSync(db, remote);
      expect(second.sent.find((t) => t.table === 'books')?.sent).toBe(0);
      expect(remote.received('books')).toHaveLength(0);
    });

    it('never sends back a book that came down from the office', async () => {
      await runSync(db, remote);
      expect(remote.received('books')).toHaveLength(0);
      expect(remote.received('book_copies')).toHaveLength(0);
    });

    it('goes up again after a librarian corrects its title', async () => {
      const book = createBook(db, { title: 'שם עם טעות' });
      await runSync(db, remote);
      remote.written.clear();

      updateBook(db, book.publicId, { title: 'השם הנכון' });
      await runSync(db, remote);

      expect(remote.received('books').map((row) => row.title)).toEqual(['השם הנכון']);
    });
  });

  describe('a category that sets its own loan period', () => {
    it('lends its books for that long instead of the library default', async () => {
      writeSetting(db, 'default_loan_days', 14);
      const textbooks = createCategory(db, { name: 'ספרי לימוד', loanDays: 300 });
      expect(textbooks.loanDays).toBe(300);

      const book = createBook(db, { title: 'חומש בראשית', categoryPublicId: textbooks.publicId });
      createCopy(db, { bookPublicId: book.publicId, barcode: 'T-1' });
      const student = createStudent(db, { firstName: 'שרה', lastName: 'כהן' });

      const loan = checkoutCopy(db, { barcode: 'T-1', studentPublicId: student.publicId });
      const days = Math.round(
        (Date.parse(loan.dueAt!) - Date.parse(loan.checkoutAt)) / (24 * 60 * 60 * 1000),
      );
      expect(days).toBe(300);
    });

    it('still lets the librarian override it for one loan', () => {
      const textbooks = createCategory(db, { name: 'ספרי לימוד', loanDays: 300 });
      const book = createBook(db, { title: 'חומש שמות', categoryPublicId: textbooks.publicId });
      createCopy(db, { bookPublicId: book.publicId, barcode: 'T-2' });
      const student = createStudent(db, { firstName: 'יוסי', lastName: 'לוי' });

      const loan = checkoutCopy(db, { barcode: 'T-2', studentPublicId: student.publicId, loanDays: 7 });
      const days = Math.round(
        (Date.parse(loan.dueAt!) - Date.parse(loan.checkoutAt)) / (24 * 60 * 60 * 1000),
      );
      expect(days).toBe(7);
    });

    it('refuses a period nobody could have meant', () => {
      expect(() => createCategory(db, { name: 'שגיאה', loanDays: 3650 })).toThrow();
      expect(() => createCategory(db, { name: 'שגיאה', loanDays: 0 })).toThrow();
    });
  });
});
