/**
 * HTTP errors of the platform service.
 *
 * The wire codes and message keys come from contract 0.1.0
 * (`schemas/api/errors.schema.json`): seven UPPER_SNAKE codes, each tied to the
 * translation key `errors.<camelCase>`. The envelope carries no human text, only
 * the code, the message key and machine-readable field paths (AD-8).
 */

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export const MESSAGE_KEYS: Readonly<Record<ApiErrorCode, string>> = {
  AUTH_REQUIRED: "errors.authRequired",
  FORBIDDEN: "errors.forbidden",
  NOT_FOUND: "errors.notFound",
  VALIDATION: "errors.validation",
  CONFLICT: "errors.conflict",
  RATE_LIMITED: "errors.rateLimited",
  INTERNAL: "errors.internal",
};

export interface ErrorDetails {
  /** Dotted paths of the invalid input fields; never user-visible text. */
  readonly fields: readonly string[];
}

const FIELD_PATH_PATTERN = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

/**
 * Only contract-shaped field paths leave the service, deduplicated and capped
 * at the contract's 100 entries. An unknown key with user text becomes its
 * parent path (or `body`), so user text never reaches an error envelope.
 */
function sanitisedFields(fields: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const field of fields) {
    const parent = field.split(".")[0] ?? "";
    const value = FIELD_PATH_PATTERN.test(field) ? field : FIELD_PATH_PATTERN.test(parent) ? parent : "body";
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
    if (result.length >= 100) {
      break;
    }
  }
  return result;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly headers: Readonly<Record<string, string>>;
  readonly details: ErrorDetails | undefined;
  /** Client requestId to echo instead of the transport one, when known. */
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: ApiErrorCode,
    options: {
      message?: string;
      headers?: Readonly<Record<string, string>>;
      details?: ErrorDetails;
      requestId?: string;
    } = {},
  ) {
    super(options.message ?? code);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.headers = options.headers ?? {};
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export function authRequired(message = "authentication is required"): HttpError {
  return new HttpError(401, "AUTH_REQUIRED", { message });
}

export function forbidden(message = "the request is not allowed"): HttpError {
  return new HttpError(403, "FORBIDDEN", { message });
}

export function notFound(message = "the resource does not exist"): HttpError {
  return new HttpError(404, "NOT_FOUND", { message });
}

export function methodNotAllowed(allowedMethods: readonly string[]): HttpError {
  const allow = [...allowedMethods].sort().join(", ");
  return new HttpError(405, "FORBIDDEN", { message: `allowed methods: ${allow}`, headers: { allow } });
}

/** Invalid input; `fields` names the offending body paths. */
export function validationFailed(fields: readonly string[] = [], message = "the request is not valid"): HttpError {
  const details = sanitisedFields(fields);
  return new HttpError(400, "VALIDATION", {
    message,
    ...(details.length === 0 ? {} : { details: { fields: details } }),
  });
}

export function payloadTooLarge(limitBytes: number): HttpError {
  return new HttpError(413, "VALIDATION", { message: `the JSON body must not exceed ${limitBytes} bytes` });
}

export function unsupportedMediaType(): HttpError {
  return new HttpError(415, "VALIDATION", { message: "the request body must use content-type application/json" });
}

export function conflict(message = "the resource already exists"): HttpError {
  return new HttpError(409, "CONFLICT", { message });
}

export function rateLimited(message = "too many requests"): HttpError {
  return new HttpError(429, "RATE_LIMITED", { message });
}

/** A dependency (the auth service or the database) is unavailable. */
export function serviceUnavailable(message = "a dependency is unavailable"): HttpError {
  return new HttpError(503, "INTERNAL", { message });
}

export function internalError(message = "internal server error"): HttpError {
  return new HttpError(500, "INTERNAL", { message });
}
