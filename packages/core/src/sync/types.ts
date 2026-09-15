/**
 * What crosses between the library computer and the online library.
 *
 * ARCHITECTURE.md AD-9: the office owns the catalogue, the people and the
 * accounts; this computer owns circulation. So the exchange is not a merge of
 * two equal copies — it is a download of everything the office decides and an
 * upload of everything that happened at the desk. Two writers that never touch
 * the same row need no conflict resolution, only a union.
 */

/** Tables the office owns, in the order they must be applied. */
export const PULL_TABLES = [
  'categories',
  'shelf_locations',
  'classes',
  'staff_users',
  'books',
  'students',
  'book_copies',
  'loans',
] as const;

export type PullTable = (typeof PULL_TABLES)[number];

/**
 * What this computer sends up, in the order the online library can accept it.
 *
 * Circulation, because that is written here. And the catalogue, because a
 * librarian may now add a book at the desk — the box of books arrives at the
 * library, and so does the scanner. Pupils, classes and accounts are absent on
 * purpose: those remain the office's (AD-9).
 */
export const PUSH_TABLES = [
  'categories',
  'shelf_locations',
  'books',
  'book_copies',
  'loans',
] as const;

export type PushTable = (typeof PUSH_TABLES)[number];

/** A row as the online library returns it: public ids, not row numbers. */
export type RemoteRow = Record<string, unknown>;

/** A loan as the online library stores it. */
export interface RemoteLoan {
  public_id: string;
  copy_id: string;
  student_id: string;
  checkout_at: string;
  due_at: string | null;
  returned_at: string | null;
  checkout_by: string | null;
  return_by: string | null;
  renewal_count: number;
  notes: string | null;
  origin: 'library' | 'office';
  confirmed_at: string | null;
  updated_at: string;
}

/**
 * The online library, as this side needs it.
 *
 * An interface rather than a Supabase client throughout, so the logic that
 * decides what to do with a row can be tested against a library that is not on
 * the internet. Every test below the transport runs offline.
 */
export interface RemoteLibrary {
  /** Rows changed at or after `since`; everything when `since` is null. */
  fetchSince(table: PullTable, since: string | null): Promise<RemoteRow[]>;
  /** Writes rows, replacing any with the same `public_id`. */
  upsert(table: PushTable, rows: readonly RemoteRow[]): Promise<void>;
  /** The staff account this computer is signed in as. */
  describeAccount(): Promise<{ email: string; displayName: string; role: string }>;
}

/** What one table's upload did. */
export interface PushResult {
  readonly table: PushTable;
  readonly sent: number;
}

/** What one table's download did. */
export interface TableResult {
  readonly table: PullTable;
  readonly received: number;
  readonly added: number;
  readonly updated: number;
  readonly skipped: number;
}

/** A row that could not be applied, and why — in words the librarian can act on. */
export interface SyncProblem {
  readonly what: string;
  readonly why: string;
}

export interface SyncReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly pulled: readonly TableResult[];
  /** Rows sent up, per table. */
  readonly sent: readonly PushResult[];
  /** Loans among them — the figure the librarian actually recognises. */
  readonly pushed: number;
  /** Office suggestions this computer accepted, and now holds. */
  readonly confirmed: number;
  /** Office suggestions still waiting, because the copy is already lent here. */
  readonly stillPending: number;
  readonly problems: readonly SyncProblem[];
}
