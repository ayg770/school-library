import { DomainError } from '@school-library/core';
import { z } from 'zod';

/**
 * Optional properties whose `undefined` has been removed.
 *
 * `exactOptionalPropertyTypes` distinguishes "absent" from "present and
 * undefined"; zod produces the latter, while the domain's input types mean the
 * former. Stripping at the boundary keeps the domain types strict.
 */
type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

function stripUndefined<T>(value: T): Defined<T> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value as Defined<T>;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined),
  ) as Defined<T>;
}

/**
 * Parses input at the API boundary (§9: validate every request).
 *
 * Zod checks the shape — that a field is a string rather than an object, that
 * a limit is a number. The domain then checks meaning, and owns the Hebrew
 * messages, so a rule is stated once rather than in two places that drift.
 */
export function parseInput<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  what: string,
): Defined<T> {
  const result = schema.safeParse(value);
  if (result.success) return stripUndefined(result.data);

  const issue = result.error.issues[0];
  const field = issue?.path.join('.');
  throw new DomainError(
    'VALIDATION',
    field ? `השדה "${field}" ב${what} אינו תקין.` : `ה${what} אינו תקין.`,
    field,
  );
}

/** Optional text field: absent keeps the current value, null clears it. */
export const optionalTextField = z.union([z.string(), z.null()]).optional();

/** Query-string helpers — every value arrives as a string. */
export const queryFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

export const queryNumber = z.coerce.number().int().optional();

export const paginationQuery = {
  limit: queryNumber,
  offset: queryNumber,
};
