/**
 * Typed errors of the platform API (contract 0.2.0).
 *
 * `code`, `messageKey` and `requestId` are never swallowed: the SDK exposes the
 * exact contract error so callers (and tests) can assert on them.
 */

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface ApiErrorOptions {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly messageKey: string;
  readonly requestId: string;
  readonly details?: { readonly fields: readonly string[] } | undefined;
  readonly message?: string;
}

export class ApiError extends Error {
  /** HTTP status; 0 when the request never reached the server. */
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly messageKey: string;
  readonly requestId: string;
  readonly details: { readonly fields: readonly string[] } | undefined;

  constructor(options: ApiErrorOptions) {
    super(options.message ?? `${options.code} (${options.messageKey})`);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.messageKey = options.messageKey;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}
