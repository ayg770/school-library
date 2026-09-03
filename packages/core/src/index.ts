export { APP_VERSION } from './version.js';
export { createLogger, type CreateLoggerOptions, type Logger } from './logger.js';
export { newPublicId } from './ids.js';
export { hashPassword, verifyPassword } from './password.js';
export {
  defaultAppDataRoot,
  ensureAppDirectories,
  resolveAppPaths,
  type AppPaths,
} from './paths.js';
export { openDatabase, readPragma, type Db, type OpenDatabaseOptions } from './db/open.js';
export { migrations } from './db/migrations/index.js';
export {
  MigrationError,
  ensureMigrationTable,
  getSchemaVersion,
  planMigrations,
  readAppliedMigrations,
  runMigrations,
  type AppliedMigration,
  type Migration,
  type MigrationErrorCode,
  type MigrationPlan,
  type MigrationReport,
} from './db/migrator.js';
export {
  DEFAULT_SETTINGS,
  ensureDefaultSettings,
  readSettings,
  writeSetting,
  type AppSettings,
} from './settings.js';
export { createAppContext, type AppContext, type CreateAppContextOptions } from './context.js';
