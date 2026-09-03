import type { Db } from './open.js';

export interface Migration {
  /** Positive, unique, and ordered. Never renumbered once released. */
  readonly version: number;
  /** Recorded in `schema_migrations` and checked on every later run. */
  readonly name: string;
  /** One or more DDL statements. Runs inside a transaction. */
  readonly sql: string;
}

export interface AppliedMigration {
  readonly version: number;
  readonly name: string;
  readonly appliedAt: string;
}

export interface MigrationPlan {
  readonly currentVersion: number;
  readonly targetVersion: number;
  readonly pending: readonly Migration[];
}

export interface MigrationReport extends MigrationPlan {
  readonly applied: readonly AppliedMigration[];
}

export type MigrationErrorCode =
  | 'DUPLICATE_VERSION'
  | 'INVALID_VERSION'
  | 'DATABASE_FROM_NEWER_VERSION'
  | 'MIGRATION_MODIFIED'
  | 'MISSING_APPLIED_MIGRATION'
  | 'MIGRATION_FAILED';

/**
 * A migration problem the operator must resolve.
 *
 * PRODUCT_SPEC.md §19: on failure, stop and preserve the database. Never
 * recreate it, and never continue as though the schema were current.
 */
export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
    this.code = code;
  }
}

const CREATE_SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INTEGER PRIMARY KEY,
    version    INTEGER NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

/** Creates the bookkeeping table. Owned by the runner, not by any migration. */
export function ensureMigrationTable(db: Db): void {
  db.exec(CREATE_SCHEMA_MIGRATIONS);
}

export function readAppliedMigrations(db: Db): AppliedMigration[] {
  ensureMigrationTable(db);
  const rows = db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: number; name: string; applied_at: string }>;
  return rows.map((row) => ({ version: row.version, name: row.name, appliedAt: row.applied_at }));
}

/** The highest applied migration version; 0 for a database with none. */
export function getSchemaVersion(db: Db): number {
  const applied = readAppliedMigrations(db);
  return applied.at(-1)?.version ?? 0;
}

/** Sorts the set and rejects a definition that cannot be applied coherently. */
function validateMigrationSet(migrations: readonly Migration[]): Migration[] {
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const seen = new Set<number>();

  for (const migration of sorted) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new MigrationError(
        'INVALID_VERSION',
        `Migration "${migration.name}" has version ${migration.version}; versions must be integers of 1 or more.`,
      );
    }
    if (seen.has(migration.version)) {
      throw new MigrationError(
        'DUPLICATE_VERSION',
        `Two migrations share version ${migration.version}. Versions must be unique.`,
      );
    }
    seen.add(migration.version);
  }

  return sorted;
}

/**
 * Works out what still needs to run, and refuses to proceed on any sign that
 * the database and this build disagree about history.
 */
export function planMigrations(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  const known = validateMigrationSet(migrations);
  const knownByVersion = new Map(known.map((migration) => [migration.version, migration]));

  for (const record of applied) {
    const migration = knownByVersion.get(record.version);

    // The database has been migrated by a build that knows more than this one.
    // Running now would apply a lower version's DDL over a newer schema.
    if (migration === undefined) {
      throw new MigrationError(
        'DATABASE_FROM_NEWER_VERSION',
        `The database has migration ${record.version} ("${record.name}") applied, which this version of the ` +
          `application does not know about. It was probably written by a newer version. Upgrade the application ` +
          `rather than downgrading the database.`,
      );
    }

    // A released migration was edited in place, so what ran against this
    // database is not what this build would run against a fresh one.
    if (migration.name !== record.name) {
      throw new MigrationError(
        'MIGRATION_MODIFIED',
        `Migration ${record.version} was applied as "${record.name}" but is now defined as "${migration.name}". ` +
          `Released migrations are immutable — add a new migration instead of editing one.`,
      );
    }
  }

  const appliedVersions = new Set(applied.map((record) => record.version));
  const currentVersion = applied.at(-1)?.version ?? 0;

  // A migration below the current version that never ran means one was skipped
  // or lost. Applying it now would run it out of order.
  const skipped = known.filter(
    (migration) => migration.version < currentVersion && !appliedVersions.has(migration.version),
  );
  if (skipped.length > 0) {
    const versions = skipped.map((migration) => migration.version).join(', ');
    throw new MigrationError(
      'MISSING_APPLIED_MIGRATION',
      `Migration(s) ${versions} were never applied, but a later migration (${currentVersion}) was. ` +
        `The database's history has a gap and cannot be brought forward safely.`,
    );
  }

  const pending = known.filter((migration) => !appliedVersions.has(migration.version));

  return {
    currentVersion,
    targetVersion: known.at(-1)?.version ?? 0,
    pending,
  };
}

/**
 * Brings the database up to the latest known schema.
 *
 * Each migration and its `schema_migrations` row commit in one transaction, so
 * a failure leaves the database at the last version that fully succeeded —
 * never half-migrated.
 */
export function runMigrations(db: Db, migrations: readonly Migration[]): MigrationReport {
  ensureMigrationTable(db);
  const plan = planMigrations(migrations, readAppliedMigrations(db));

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const applied: AppliedMigration[] = [];

  for (const migration of plan.pending) {
    const appliedAt = new Date().toISOString();
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, appliedAt);
    });

    try {
      apply();
    } catch (cause) {
      // Versions are not necessarily contiguous, so report the last one that
      // actually committed rather than counting forward from the start.
      const lastGoodVersion = applied.at(-1)?.version ?? plan.currentVersion;
      throw new MigrationError(
        'MIGRATION_FAILED',
        `Migration ${migration.version} ("${migration.name}") failed and was rolled back. ` +
          `The database remains at version ${lastGoodVersion}.`,
        { cause },
      );
    }

    applied.push({ version: migration.version, name: migration.name, appliedAt });
  }

  return { ...plan, applied };
}
