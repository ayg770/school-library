import { openDatabase, type Db } from './db/open.js';
import { migrations } from './db/migrations/index.js';
import { runMigrations, type MigrationReport } from './db/migrator.js';
import { createLogger, type Logger } from './logger.js';
import { ensureAppDirectories, resolveAppPaths, type AppPaths } from './paths.js';
import { ensureDefaultSettings, readSettings, type AppSettings } from './settings.js';
import { APP_VERSION } from './version.js';

export interface AppContext {
  readonly paths: AppPaths;
  readonly db: Db;
  readonly logger: Logger;
  readonly appVersion: string;
  /** Highest applied migration version. Shown on the support screen (§24). */
  readonly schemaVersion: number;
  readonly settings: AppSettings;
  readonly migrationReport: MigrationReport;
  close(): void;
}

export interface CreateAppContextOptions {
  /** Overrides the OS application data directory. Tests pass a temp path. */
  readonly dataRoot?: string;
  readonly logger?: Logger;
}

/**
 * Starts the application: directories, logging, database, migrations, settings.
 *
 * Order matters. Directories exist before the database file is opened;
 * migrations complete before anything reads a table. If a migration fails the
 * database is closed and the error propagates — PRODUCT_SPEC.md §19 requires
 * stopping, not carrying on against an unknown schema.
 */
export function createAppContext(options: CreateAppContextOptions = {}): AppContext {
  const paths = resolveAppPaths(options.dataRoot);
  ensureAppDirectories(paths);

  const logger = options.logger ?? createLogger({ logDirectory: paths.logs });
  const db = openDatabase({ file: paths.databaseFile });

  let migrationReport: MigrationReport;
  try {
    migrationReport = runMigrations(db, migrations);
    ensureDefaultSettings(db);
  } catch (error) {
    logger.error({ err: error }, 'Startup failed; database left untouched');
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

  logger.info({ dataRoot: paths.root, schemaVersion: migrationReport.targetVersion }, 'Application ready');

  return {
    paths,
    db,
    logger,
    appVersion: APP_VERSION,
    schemaVersion: migrationReport.targetVersion,
    settings,
    migrationReport,
    close: () => db.close(),
  };
}
