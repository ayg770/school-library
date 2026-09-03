/**
 * Structured error payloads.
 *
 * PRODUCT_SPEC.md §9: return an error code a caller can branch on, and never
 * expose SQL or internals. §24: the human-facing message is short Hebrew with
 * a clear recovery action; the code is what integrations match on.
 */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

export function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}
