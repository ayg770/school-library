/**
 * The UI's only contract with the service (ARCHITECTURE.md AD-2).
 * These types mirror the responses in `@school-library/server`.
 */

export interface SystemInfo {
  appVersion: string;
  schemaVersion: number;
  paths: {
    root: string;
    database: string;
    backups: string;
    logs: string;
    imports: string;
    exports: string;
  };
  settings: {
    school_name: string;
    default_loan_days: number;
    max_active_loans_per_student: number;
    interface_language: string;
    lan_enabled: boolean;
    backup_retention_count: number;
    automatic_backup_enabled: boolean;
  };
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  downloadUrl: string | null;
  publishedAt: string | null;
  problem: string | null;
}

export interface CategoryBreakdown {
  publicId: string;
  name: string;
  titles: number;
  copies: number;
}

export interface ShelfBreakdown {
  publicId: string;
  name: string;
  room: string | null;
  copies: number;
  onLoan: number;
}

export interface CatalogueBreakdown {
  categories: CategoryBreakdown[];
  shelves: ShelfBreakdown[];
  uncategorisedTitles: number;
  unplacedCopies: number;
}

export interface HealthStatus {
  status: 'ok';
  appVersion: string;
  schemaVersion: number;
  checkedAt: string;
}

export interface SchoolClass {
  publicId: string;
  name: string;
  grade: string | null;
  section: string | null;
  academicYear: string | null;
  externalClassId: string | null;
  active: boolean;
}

export interface Student {
  publicId: string;
  firstName: string;
  lastName: string;
  classPublicId: string | null;
  className: string | null;
  localBarcode: string | null;
  active: boolean;
  notes: string | null;
}

export interface Category {
  publicId: string;
  name: string;
  parentPublicId: string | null;
  active: boolean;
}

export interface ShelfLocation {
  publicId: string;
  name: string;
  room: string | null;
  shelfCode: string | null;
  active: boolean;
}

export type ConditionStatus = 'normal' | 'damaged' | 'lost' | 'repair' | 'withdrawn';

export interface BookCopy {
  publicId: string;
  bookPublicId: string;
  bookTitle: string;
  barcode: string;
  shelfPublicId: string | null;
  shelfName: string | null;
  conditionStatus: ConditionStatus;
  conditionNote: string | null;
  active: boolean;
}

export interface Book {
  publicId: string;
  title: string;
  subtitle: string | null;
  authorText: string | null;
  publisher: string | null;
  publicationYear: string | null;
  isbn10: string | null;
  isbn13: string | null;
  categoryPublicId: string | null;
  categoryName: string | null;
  notes: string | null;
  active: boolean;
  copyCount: number;
}

export interface BookCopyWithLoan extends BookCopy {
  onLoan: boolean;
  borrowerName: string | null;
  dueAt: string | null;
  overdue: boolean;
}

export interface BookDetail extends Book {
  copies: BookCopyWithLoan[];
}

export interface Loan {
  publicId: string;
  copyPublicId: string;
  barcode: string;
  bookPublicId: string;
  bookTitle: string;
  bookAuthor: string | null;
  studentPublicId: string;
  studentFirstName: string;
  studentLastName: string;
  className: string | null;
  checkoutAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  renewalCount: number;
  notes: string | null;
  overdue: boolean;
  daysOverdue: number;
}

export interface CheckinResult {
  loan: Loan;
  wasOverdue: boolean;
}

export interface StudentLibrarySummary {
  student: Student;
  activeLoanCount: number;
  overdueCount: number;
  activeLoans: Loan[];
  lifetimeLoanCount: number;
  lastActivityAt: string | null;
}

export interface BackupFile {
  id: string;
  path: string;
  reason: 'manual' | 'before-migration' | 'before-restore' | 'automatic';
  createdAt: string;
  sizeBytes: number;
  schemaVersion: number | null;
}

export interface BackupCheck {
  ok: boolean;
  integrity: string;
  schemaVersion: number;
  problems: string[];
}

export interface DashboardSummary {
  activeLoans: number;
  overdue: number;
  returnedToday: number;
  checkedOutToday: number;
  titles: number;
  copies: number;
  copiesOnShelf: number;
  students: number;
  generatedAt: string;
}

export interface IntakeResult {
  copy: BookCopy;
  book: Book;
  createdTitle: boolean;
}

export type Role = 'admin' | 'librarian' | 'read_only';

export interface StaffUser {
  publicId: string;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
}

export interface SessionState {
  user: StaffUser | null;
  setupRequired: boolean;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'מנהל מערכת',
  librarian: 'ספרן',
  read_only: 'צפייה בלבד',
};

export type ImportType = 'students' | 'books';
export type RowStatus = 'pending' | 'ready' | 'warning' | 'error' | 'skipped' | 'imported' | 'failed';

export interface TargetField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
}

export interface ImportBatch {
  publicId: string;
  filename: string;
  importType: ImportType;
  status: 'parsed' | 'validated' | 'committed' | 'cancelled';
  mapping: Record<string, number> | null;
  headers: string[];
  totalRows: number;
  successCount: number;
  warningCount: number;
  errorCount: number;
}

export interface ImportRow {
  rowNumber: number;
  raw: string[];
  normalized: Record<string, string> | null;
  status: RowStatus;
  problems: string[];
}

export interface UploadResult {
  batch: ImportBatch;
  suggestedMapping: Record<string, number>;
  fields: TargetField[];
  encoding?: string;
  preview: ImportRow[];
}

export interface CommitReport {
  batch: ImportBatch;
  imported: number;
  failed: number;
  skipped: number;
  createdClasses: string[];
  createdCategories: string[];
  createdShelves: string[];
}

export interface PagedResult<T> {
  items: T[];
  total: number;
}

/**
 * An error the service reported, carrying its code and the Hebrew message
 * meant for the librarian (§24). `field` marks the input to highlight.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly field: string | undefined;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.field = field;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        // Only when there is something to describe. Declaring a JSON body and
        // sending none is rejected by the server, which is what a POST with no
        // payload — "back up now", "run the import" — would otherwise do.
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('SERVICE_UNREACHABLE', 'אין תקשורת עם השירות המקומי. ודא שהוא פועל.');
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(
      error?.code ?? 'UNKNOWN',
      error?.message ?? `השרת המקומי החזיר שגיאה ${response.status}.`,
    );
  }

  return body as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}

export const api = {
  session: () => request<SessionState>('/api/v1/auth/session'),
  login: (username: string, password: string) =>
    request<{ user: StaffUser }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>('/api/v1/auth/logout', { method: 'POST' }),
  setup: (body: { username: string; password: string; displayName: string }) =>
    request<{ user: StaffUser }>('/api/v1/auth/setup', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listStaff: () => request<{ items: StaffUser[] }>('/api/v1/staff'),
  createStaff: (body: Record<string, unknown>) =>
    request<StaffUser>('/api/v1/staff', { method: 'POST', body: JSON.stringify(body) }),
  updateStaff: (publicId: string, body: Record<string, unknown>) =>
    request<StaffUser>(`/api/v1/staff/${publicId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  health: (signal?: AbortSignal) =>
    request<HealthStatus>('/api/v1/health', signal ? { signal } : undefined),
  systemInfo: (signal?: AbortSignal) =>
    request<SystemInfo>('/api/v1/system/info', signal ? { signal } : undefined),

  checkForUpdate: () => request<UpdateStatus>('/api/v1/system/update'),

  listClasses: () => request<PagedResult<SchoolClass>>('/api/v1/classes?limit=200'),
  createClass: (body: Record<string, unknown>) =>
    request<SchoolClass>('/api/v1/classes', { method: 'POST', body: JSON.stringify(body) }),

  listStudents: (params: { query?: string; classPublicId?: string; active?: boolean }) =>
    request<PagedResult<Student>>(`/api/v1/students${query({ ...params, limit: 200 })}`),
  createStudent: (body: Record<string, unknown>) =>
    request<Student>('/api/v1/students', { method: 'POST', body: JSON.stringify(body) }),
  updateStudent: (publicId: string, body: Record<string, unknown>) =>
    request<Student>(`/api/v1/students/${publicId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  listCategories: () => request<{ items: Category[] }>('/api/v1/categories'),
  createCategory: (body: Record<string, unknown>) =>
    request<Category>('/api/v1/categories', { method: 'POST', body: JSON.stringify(body) }),

  listShelves: () => request<{ items: ShelfLocation[] }>('/api/v1/shelf-locations'),
  createShelf: (body: Record<string, unknown>) =>
    request<ShelfLocation>('/api/v1/shelf-locations', { method: 'POST', body: JSON.stringify(body) }),

  listBooks: (params: {
    query?: string;
    categoryPublicId?: string;
    shelfPublicId?: string;
    active?: boolean;
  }) => request<PagedResult<Book>>(`/api/v1/books${query({ ...params, limit: 200 })}`),

  catalogueBreakdown: () => request<CatalogueBreakdown>('/api/v1/catalogue/breakdown'),
  getBook: (publicId: string) => request<BookDetail>(`/api/v1/books/${publicId}`),
  createBook: (body: Record<string, unknown>) =>
    request<Book>('/api/v1/books', { method: 'POST', body: JSON.stringify(body) }),
  updateBook: (publicId: string, body: Record<string, unknown>) =>
    request<Book>(`/api/v1/books/${publicId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  createCopy: (body: Record<string, unknown>) =>
    request<BookCopy>('/api/v1/copies', { method: 'POST', body: JSON.stringify(body) }),

  checkout: (body: { studentPublicId: string; barcode: string }) =>
    request<Loan>('/api/v1/circulation/checkout', { method: 'POST', body: JSON.stringify(body) }),
  checkin: (barcode: string) =>
    request<CheckinResult>('/api/v1/circulation/checkin', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    }),
  renew: (loanPublicId: string) =>
    request<Loan>('/api/v1/circulation/renew', { method: 'POST', body: JSON.stringify({ loanPublicId }) }),

  uploadImport: async (file: File, importType: ImportType): Promise<UploadResult> => {
    const form = new FormData();
    form.set('importType', importType);
    form.set('file', file);

    // No Content-Type header: the browser sets it with the multipart boundary.
    const response = await fetch('/api/v1/imports', { method: 'POST', body: form });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(error?.code ?? 'UNKNOWN', error?.message ?? 'העלאת הקובץ נכשלה.');
    }
    return body as UploadResult;
  },
  getImport: (publicId: string) =>
    request<{ batch: ImportBatch; fields: TargetField[] }>(`/api/v1/imports/${publicId}`),
  getImportRows: (publicId: string, status?: RowStatus) =>
    request<PagedResult<ImportRow>>(`/api/v1/imports/${publicId}/rows${query({ status, limit: 200 })}`),
  validateImport: (publicId: string, mapping: Record<string, number>) =>
    request<ImportBatch>(`/api/v1/imports/${publicId}/validate`, {
      method: 'POST',
      body: JSON.stringify({ mapping }),
    }),
  commitImport: (publicId: string) =>
    request<CommitReport>(`/api/v1/imports/${publicId}/commit`, { method: 'POST' }),

  dashboard: () => request<DashboardSummary>('/api/v1/dashboard'),
  intake: (body: Record<string, unknown>) =>
    request<IntakeResult>('/api/v1/intake', { method: 'POST', body: JSON.stringify(body) }),

  listBackups: () => request<{ items: BackupFile[] }>('/api/v1/backups'),
  createBackup: () => request<BackupFile>('/api/v1/backups', { method: 'POST' }),
  verifyBackup: (id: string) => request<BackupCheck>(`/api/v1/backups/${encodeURIComponent(id)}/verify`),
  restoreBackup: (id: string) =>
    request<{ restoredFrom: BackupFile; safetyBackup: BackupFile }>(
      `/api/v1/backups/${encodeURIComponent(id)}/restore`,
      { method: 'POST', body: JSON.stringify({ confirm: true }) },
    ),

  listLoans: (params: { studentPublicId?: string; bookPublicId?: string; status?: string }) =>
    request<PagedResult<Loan>>(`/api/v1/loans${query({ ...params, limit: 200 })}`),
  studentSummary: (publicId: string) =>
    request<StudentLibrarySummary>(`/api/v1/students/${publicId}/library-summary`),
  updateCopy: (publicId: string, body: Record<string, unknown>) =>
    request<BookCopy>(`/api/v1/copies/${publicId}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

/** Dates are shown in the browser's locale, which on the library PC is Hebrew. */
export function formatDate(iso: string | null): string {
  if (iso === null) return '—';
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleDateString('he-IL');
}

export function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('he-IL');
}

/**
 * Hebrew agrees with the count, so "1 תלמידים" is wrong. One takes the
 * singular; everything else takes the plural.
 */
export function plural(count: number, singular: string, plural_: string): string {
  return `${count} ${count === 1 ? singular : plural_}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} בייט`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const BACKUP_REASON_LABELS: Record<BackupFile['reason'], string> = {
  manual: 'ידני',
  automatic: 'אוטומטי',
  'before-migration': 'לפני עדכון גרסה',
  'before-restore': 'לפני שחזור',
};

export const CONDITION_LABELS: Record<ConditionStatus, string> = {
  normal: 'תקין',
  damaged: 'פגום',
  lost: 'אבוד',
  repair: 'בתיקון',
  withdrawn: 'הוצא משימוש',
};
