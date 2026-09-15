import type { PullTable } from './types.js';

/**
 * How a row from the online library becomes a row here.
 *
 * Written as a description rather than as eight near-identical blocks of SQL:
 * the two schemas were built to mirror each other, so the only thing that
 * actually differs per table is the list of columns and which of them point at
 * another row. Spelling that out once makes the differences visible — and the
 * order of `PULL_TABLES` is then the only thing keeping references valid.
 */

export type ColumnKind = 'text' | 'number' | 'bool' | 'ref' | 'timestamp';

export interface ColumnSpec {
  /** Column name here. */
  readonly local: string;
  /** Column name in the online library. */
  readonly remote: string;
  readonly kind: ColumnKind;
  /** For `ref`: the table whose `public_id` the value is. */
  readonly refTable?: PullTable;
}

export interface TableSpec {
  readonly table: PullTable;
  /** Local table name, when it differs from the wire name. Always the same here. */
  readonly columns: readonly ColumnSpec[];
  /**
   * A column that identifies the same real-world thing under a different id.
   *
   * The library computer may already hold a catalogue it imported from a
   * spreadsheet before it ever met the online library. Those rows are the same
   * books, with their own local ids. Matching on the barcode — the number
   * printed on the physical label — lets the local row adopt the online id
   * instead of colliding with it on a unique index.
   */
  readonly naturalKey?: string;
}

const text = (local: string, remote = local): ColumnSpec => ({ local, remote, kind: 'text' });
/**
 * A moment in time, which the two sides spell differently.
 *
 * Postgres hands back `2026-09-14T21:02:33.123456+00:00`; this side writes
 * `2026-09-14T21:02:33.123Z`. Both are the same instant and neither is wrong,
 * but they sort differently as text — and the mark for "everything changed
 * since" is compared as text. Normalising on the way in keeps every timestamp
 * in the database in one spelling, so those comparisons mean what they say.
 */
const time = (local: string, remote = local): ColumnSpec => ({ local, remote, kind: 'timestamp' });
const num = (local: string, remote = local): ColumnSpec => ({ local, remote, kind: 'number' });
const bool = (local: string, remote = local): ColumnSpec => ({ local, remote, kind: 'bool' });
const ref = (local: string, remote: string, refTable: PullTable): ColumnSpec => ({
  local,
  remote,
  kind: 'ref',
  refTable,
});

export const TABLE_SPECS: Readonly<Record<PullTable, TableSpec>> = {
  categories: {
    table: 'categories',
    columns: [text('name'), ref('parent_id', 'parent_id', 'categories'), bool('active')],
  },
  shelf_locations: {
    table: 'shelf_locations',
    columns: [text('name'), text('room'), text('shelf_code'), bool('active')],
  },
  classes: {
    table: 'classes',
    columns: [
      text('external_class_id'),
      text('name'),
      text('grade'),
      text('section'),
      text('academic_year'),
      bool('active'),
    ],
  },
  staff_users: {
    // `password_hash` is deliberately absent. The office decides who the staff
    // are; this computer decides how they prove it, and a password set here
    // never travels.
    table: 'staff_users',
    columns: [text('username'), text('display_name'), text('role'), text('email'), bool('active')],
    naturalKey: 'username',
  },
  books: {
    table: 'books',
    columns: [
      text('title'),
      text('subtitle'),
      text('author_text'),
      text('publisher'),
      text('publication_year'),
      text('isbn10'),
      text('isbn13'),
      text('language'),
      ref('category_id', 'category_id', 'categories'),
      text('default_call_number'),
      text('notes'),
      bool('active'),
    ],
  },
  students: {
    table: 'students',
    columns: [
      text('first_name'),
      text('last_name'),
      ref('class_id', 'class_id', 'classes'),
      text('local_barcode'),
      text('notes'),
      bool('active'),
    ],
    naturalKey: 'local_barcode',
  },
  book_copies: {
    table: 'book_copies',
    columns: [
      ref('book_id', 'book_id', 'books'),
      text('barcode'),
      text('legacy_id'),
      text('accession_number'),
      ref('shelf_location_id', 'shelf_location_id', 'shelf_locations'),
      text('condition_status'),
      text('purchase_date'),
      num('price_cents'),
      text('condition_note'),
      time('verified_at'),
      bool('active'),
    ],
    naturalKey: 'barcode',
  },
  loans: {
    table: 'loans',
    columns: [
      ref('copy_id', 'copy_id', 'book_copies'),
      ref('student_id', 'student_id', 'students'),
      time('checkout_at'),
      time('due_at'),
      time('returned_at'),
      ref('checkout_by_user_id', 'checkout_by', 'staff_users'),
      ref('return_by_user_id', 'return_by', 'staff_users'),
      num('renewal_count'),
      text('notes'),
      text('origin'),
      time('confirmed_at'),
    ],
  },
};

/**
 * The stand-in stored where a password would be for an account that arrived
 * from the office.
 *
 * `verifyPassword` rejects any stored value it cannot parse, and this is not a
 * hash in any format, so no password matches it. The account exists and is
 * listed; it simply cannot be signed in to until an administrator here gives
 * it one.
 */
export const NO_LOCAL_PASSWORD = 'no-local-password';
