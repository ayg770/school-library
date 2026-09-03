import type { Db } from '../db/open.js';
import { DomainError } from './errors.js';

export function nowIso(): string {
  return new Date().toISOString();
}

/** SQLite stores booleans as 0/1. */
export function toDbBool(value: boolean): number {
  return value ? 1 : 0;
}

export function fromDbBool(value: number): boolean {
  return value === 1;
}

/** A required field: present, and not only whitespace. */
export function requireText(value: unknown, field: string, label: string, maxLength = 500): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DomainError('VALIDATION', `${label} הוא שדה חובה.`, field);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new DomainError('VALIDATION', `${label} ארוך מדי (עד ${maxLength} תווים).`, field);
  }
  return trimmed;
}

/** An optional field. Empty or whitespace-only becomes null, never ''. */
export function optionalText(value: unknown, field: string, label: string, maxLength = 500): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new DomainError('VALIDATION', `${label} אינו תקין.`, field);
  }
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (trimmed.length > maxLength) {
    throw new DomainError('VALIDATION', `${label} ארוך מדי (עד ${maxLength} תווים).`, field);
  }
  return trimmed;
}

const MAX_BARCODE_LENGTH = 100;

/**
 * Validates a barcode without altering it.
 *
 * PRODUCT_SPEC.md §7 and §34: barcodes are stored exactly as given, because
 * leading zeros are significant and a scan is matched exactly. Whitespace is
 * therefore rejected rather than stripped — silently trimming would turn one
 * library's barcode into a different one, and the mismatch would surface much
 * later as a book that cannot be found.
 */
export function requireBarcode(value: unknown, field = 'barcode'): string {
  if (typeof value !== 'string' || value === '') {
    throw new DomainError('VALIDATION', 'ברקוד הוא שדה חובה.', field);
  }
  if (/\s/.test(value)) {
    throw new DomainError(
      'VALIDATION',
      'הברקוד מכיל רווח או ירידת שורה. תקן את המקור — הערך נשמר בדיוק כפי שהוזן.',
      field,
    );
  }
  if (value.length > MAX_BARCODE_LENGTH) {
    throw new DomainError('VALIDATION', `הברקוד ארוך מדי (עד ${MAX_BARCODE_LENGTH} תווים).`, field);
  }
  return value;
}

/** Resolves a referenced row's public id to its internal id. */
export function resolveReference(
  db: Db,
  table: 'classes' | 'categories' | 'shelf_locations' | 'books',
  publicId: string | null | undefined,
  label: string,
  field: string,
): number | null {
  if (publicId === null || publicId === undefined || publicId === '') return null;

  const row = db.prepare(`SELECT id FROM ${table} WHERE public_id = ?`).get(publicId) as
    | { id: number }
    | undefined;

  if (row === undefined) {
    throw new DomainError('REFERENCE_NOT_FOUND', `${label} שנבחר לא נמצא.`, field);
  }
  return row.id;
}

/** Escapes `%` and `_` so a user's search text is matched literally. */
export function likePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export function normalisePage(limit?: number, offset?: number): Page {
  return {
    limit: Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT),
    offset: Math.max(offset ?? 0, 0),
  };
}

/** Maps SQLite's UNIQUE violations onto domain errors. */
export function translateUniqueViolation(error: unknown, mappings: Record<string, DomainError>): never {
  const message = error instanceof Error ? error.message : '';
  for (const [fragment, domainError] of Object.entries(mappings)) {
    if (message.includes(fragment)) throw domainError;
  }
  throw error;
}
