/**
 * Errors the domain raises, carrying a code the API turns into a structured
 * response (§9) and a short Hebrew message with a recovery action (§24).
 */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'DUPLICATE_BARCODE'
  | 'DUPLICATE_VALUE'
  | 'REFERENCE_NOT_FOUND'
  | 'INVALID_PARENT'
  // Circulation (Phase 2)
  | 'COPY_NOT_FOUND'
  | 'COPY_ALREADY_ON_LOAN'
  | 'COPY_NOT_AVAILABLE'
  | 'STUDENT_INACTIVE'
  | 'LOAN_LIMIT_REACHED'
  | 'NOT_ON_LOAN'
  | 'LOAN_ALREADY_RETURNED';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  DUPLICATE_BARCODE: 409,
  DUPLICATE_VALUE: 409,
  REFERENCE_NOT_FOUND: 400,
  INVALID_PARENT: 400,
  COPY_NOT_FOUND: 404,
  COPY_ALREADY_ON_LOAN: 409,
  COPY_NOT_AVAILABLE: 409,
  STUDENT_INACTIVE: 409,
  LOAN_LIMIT_REACHED: 409,
  NOT_ON_LOAN: 409,
  LOAN_ALREADY_RETURNED: 409,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;
  /** Field the problem relates to, when there is one. */
  readonly field: string | undefined;

  constructor(code: DomainErrorCode, message: string, field?: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.httpStatus = STATUS_BY_CODE[code];
    this.field = field;
  }
}

export function notFound(what: string): DomainError {
  return new DomainError('NOT_FOUND', `${what} לא נמצא.`);
}
