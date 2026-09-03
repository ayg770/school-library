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
  | 'INVALID_PARENT';

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  VALIDATION: 400,
  DUPLICATE_BARCODE: 409,
  DUPLICATE_VALUE: 409,
  REFERENCE_NOT_FOUND: 400,
  INVALID_PARENT: 400,
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
