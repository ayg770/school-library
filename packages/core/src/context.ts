import { createBackupSync, pruneBackups, type BackupFile } from './backup.js';
import { openDatabase, type Db } from './db/open.js';
import { migrations } from './db/migrations/index.js';
import {
  planMigrations,
  readAppliedMigrations,
  runMigrations,
  type MigrationReport,
} from './db/migrator.js';
import { createLogger, type Logger } from './logger.js';
import { ensureAppDirectories, resolveAppPaths, type AppPaths } from './paths.js';
import { ensureDefaultSettings, readSettings, type AppSettings } from './settings.js';
import { APP_VERSION } from './version.js';

export interface AppContext {
  readonly paths: AppPaths;
  /**
   * The live connection.
   *
   * A getter rather than a fixed reference, because a restore closes the
   * database and opens the replacement — callers that hold `context` keep
   * working without having to know that happened.
   */
  readonly db: Db;
  readonly logger: Logger;
  readonly appVersion: string;
  /** Highest applied migration version. Shown on the support screen (§24). */
  readonly schemaVersion: number;
  readonly settings: AppSettings;
  readonly migrationReport: MigrationReport;
  /** The snapshot taken before migrations ran, when any were pending (§19). */
  readonly startupBackup: BackupFile | null;
  /** Used by a restore to swap the underlying file. */
  closeDatabase(): void;
  reopenDatabase(): void;
  close(): void;
}

export interface CreateAppContextOptions {
  /** Overrides the OS application data directory. Tests pass a temp path. */
  readonly dataRoot?: string;
  readonly logger?: Logger;
  /** Skips the pre-migration backup. Tests use it; production never should. */
  readonly skipStartupBackup?: boolean;
}

/**
 * Starts the application: directories, logging, database, backup, migrations,
 * settings.
 *
 * The order is what PRODUCT_SPEC.md §19 asks for. Directories exist before the
 * database is opened; a database that is about to be migrated is backed up
 * first; migrations complete before anything reads a table. If a migration
 * fails, the database is closed and the error propagates with the backup still
 * on disk — §19 requires stopping and preserving a recovery path, never
 * carrying on against an unknown schema and never recreating the database.
 */
export function createAppContext(options: CreateAppContextOptions = {}): AppContext {
  const paths = resolveAppPaths(options.dataRoot);
  ensureAppDirectories(paths);

  const logger = options.logger ?? createLogger({ logDirectory: paths.logs });
  let db = openDatabase({ file: paths.databaseFile });

  let migrationReport: MigrationReport;
  let startupBackup: BackupFile | null = null;

  try {
    const plan = planMigrations(migrations, readAppliedMigrations(db));

    // Only when there is something to lose and something about to change: a
    // brand-new database has nothing to back up, and an up-to-date one is not
    // being touched.
    if (plan.pending.length > 0 && plan.currentVersion > 0 && options.skipStartupBackup !== true) {
      startupBackup = createBackupSync(db, paths, 'before-migration');
      logger.info(
        { backup: startupBackup.id, fromVersion: plan.currentVersion },
        'Backed up before migrating',
      );
    }

    migrationReport = runMigrations(db, migrations);
    ensureDefaultSettings(db);
  } catch (error) {
    logger.error(
      { err: error, backup: startupBackup?.id ?? null },
      'Startup failed; the database was left as it was',
    );
    db.close();
    throw error;
  }

  if (migrationReport.applied.length > 0) {
    logger.info(
      {
        from: migrationReport.currentVersion,
        to: migrationReport.targetVersion,
        applied: migrationReport.applied.map((entry) => entry.version),
      },
      'Applied database migrations',
    );
  }

  const settings = readSettings(db, (key, reason) => {
    logger.warn({ key, reason }, 'Ignoring invalid stored setting; using its default');
  });

  const pruned = pruneBackups(paths, settings.backup_retention_count);
  if (pruned.length > 0) {
    logger.info({ removed: pruned.length }, 'Pruned old backups beyond the retention count');
  }

  logger.info({ dataRoot: paths.root, schemaVersion: migrationReport.targetVersion }, 'Application ready');

  return {
    paths,
    get db(): Db {
      return db;
    },
    logger,
    appVersion: APP_VERSION,
    schemaVersion: migrationReport.targetVersion,
    settings,
    migrationReport,
    startupBackup,
    closeDatabase: () => db.close(),
    reopenDatabase: () => {
      db = openDatabase({ file: paths.databaseFile });
    },
    close: () => db.close(),
  };
}
