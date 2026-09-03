import { randomUUID } from 'node:crypto';

/**
 * Generates a `public_id`.
 *
 * PRODUCT_SPEC.md §9: APIs expose these, never internal row ids. Keeping the
 * two separate means a row can be renumbered, exported or re-imported without
 * invalidating an identifier another system has already stored.
 */
export function newPublicId(): string {
  return randomUUID();
}
