import Database from 'better-sqlite3';

export type Db = Database.Database;

export interface OpenDatabaseOptions {
  /** Path to the SQLite file, or `:memory:` for an ephemeral database. */
  readonly file: string;
  /** Milliseconds to wait on a locked database before failing. §5 suggests 5000. */
  readonly busyTimeoutMs?: number;
}

const DEFAULT_BUSY_TIMEOUT_MS = 5000;

/**
 * Opens the database with the pragmas PRODUCT_SPEC.md §5 requires.
 *
 * WAL is safe here only because every connection lives on the library host —
 * §5 forbids putting a WAL database on an SMB/NFS share. It is skipped for
 * in-memory databases, which have no journal file to keep.
 */
export function openDatabase(options: OpenDatabaseOptions): Db {
  const db = new Database(options.file);
  const isMemory = options.file === ':memory:';

  if (!isMemory) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS}`);

  return db;
}

/** Reads a single pragma value back, for diagnostics and tests. */
export function readPragma(db: Db, name: string): unknown {
  const rows = db.pragma(name) as Array<Record<string, unknown>>;
  const first = rows[0];
  if (first === undefined) return undefined;
  return Object.values(first)[0];
}
