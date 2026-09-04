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

// --- Catalog (Phase 1) ---
export { DomainError, notFound, type DomainErrorCode } from './domain/errors.js';
export {
  createClass,
  getClass,
  listClasses,
  updateClass,
  type CreateClassInput,
  type ListClassesOptions,
  type SchoolClass,
  type UpdateClassInput,
} from './domain/classes.js';
export {
  createCategory,
  getCategory,
  listCategories,
  updateCategory,
  type Category,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from './domain/categories.js';
export {
  createShelf,
  getShelf,
  listShelves,
  updateShelf,
  type CreateShelfInput,
  type ShelfLocation,
  type UpdateShelfInput,
} from './domain/shelves.js';
export {
  createStudent,
  findStudentByBarcode,
  getStudent,
  listStudents,
  updateStudent,
  type CreateStudentInput,
  type ListStudentsOptions,
  type Student,
  type UpdateStudentInput,
} from './domain/students.js';
export {
  createBook,
  getBook,
  listBooks,
  updateBook,
  type Book,
  type CreateBookInput,
  type ListBooksOptions,
  type UpdateBookInput,
} from './domain/books.js';
export {
  CONDITION_STATUSES,
  createCopy,
  findCopyByBarcode,
  getCopy,
  listCopies,
  updateCopy,
  type BookCopy,
  type ConditionStatus,
  type CreateCopyInput,
  type ListCopiesOptions,
  type UpdateCopyInput,
} from './domain/copies.js';

// --- Circulation (Phase 2) ---
export {
  listAudit,
  recordAudit,
  type AuditAction,
  type AuditEntry,
  type AuditRecord,
} from './domain/audit.js';
export {
  addDays,
  checkinByBarcode,
  checkoutCopy,
  countActiveLoans,
  getLoan,
  getStudentLibrarySummary,
  listLoans,
  renewLoan,
  type CheckinResult,
  type CheckoutInput,
  type ListLoansOptions,
  type Loan,
  type StudentLibrarySummary,
} from './domain/circulation.js';

// --- Backup and restore (Phase 5) ---
export {
  BackupError,
  createBackup,
  createBackupSync,
  listBackups,
  pruneBackups,
  restoreBackup,
  verifyBackup,
  type BackupCheck,
  type BackupFile,
  type BackupReason,
  type RestoreResult,
} from './backup.js';

// --- Import (Phase 4) ---
export { IMPORT_FIELDS, suggestMapping, type ImportType, type TargetField } from './import/fields.js';
export {
  decodeText,
  detectFormat,
  parseCsvBuffer,
  parseFile,
  parseXlsxBuffer,
  type ParsedSheet,
  type SourceFormat,
} from './import/parse.js';
export {
  cancelImportBatch,
  commitImportBatch,
  createImportBatch,
  getImportBatch,
  listImportBatches,
  listImportRows,
  validateImportBatch,
  type BatchStatus,
  type ColumnMapping,
  type CommitReport,
  type ImportBatch,
  type ImportRow,
  type RowStatus,
} from './import/runner.js';

// --- Staff accounts and sign-in ---
export {
  ROLES,
  createStaffUser,
  describeRole,
  getStaffUser,
  listStaffUsers,
  needsFirstUser,
  purgeExpiredSessions,
  resolveSession,
  revokeAllSessionsFor,
  roleAllows,
  signIn,
  signOut,
  updateStaffUser,
  type CreateStaffUserInput,
  type Role,
  type Session,
  type StaffUser,
  type UpdateStaffUserInput,
} from './domain/auth.js';

// --- Home screen ---
export { getDashboardSummary, type DashboardSummary } from './domain/dashboard.js';
export { intakeCopy, type IntakeInput, type IntakeResult } from './domain/intake.js';
