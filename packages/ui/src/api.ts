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
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
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
  health: (signal?: AbortSignal) =>
    request<HealthStatus>('/api/v1/health', signal ? { signal } : undefined),
  systemInfo: (signal?: AbortSignal) =>
    request<SystemInfo>('/api/v1/system/info', signal ? { signal } : undefined),

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

  listBooks: (params: { query?: string; categoryPublicId?: string; active?: boolean }) =>
    request<PagedResult<Book>>(`/api/v1/books${query({ ...params, limit: 200 })}`),
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

export const CONDITION_LABELS: Record<ConditionStatus, string> = {
  normal: 'תקין',
  damaged: 'פגום',
  lost: 'אבוד',
  repair: 'בתיקון',
  withdrawn: 'הוצא משימוש',
};
