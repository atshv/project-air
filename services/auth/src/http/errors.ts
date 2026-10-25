/**
 * HTTP errors that a route or middleware may throw.
 *
 * The router turns every `HttpError` into a JSON error envelope and maps an
 * unexpected error to a generic 500 so no internal detail leaks to the client.
 */

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE";

export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, code: ApiErrorCode, message: string, headers: Readonly<Record<string, string>> = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function badRequest(message = "the request is not valid"): HttpError {
  return new HttpError(400, "BAD_REQUEST", message);
}

export function notFound(message = "the route does not exist"): HttpError {
  return new HttpError(404, "NOT_FOUND", message);
}

export function methodNotAllowed(allowedMethods: readonly string[]): HttpError {
  const allow = [...allowedMethods].sort().join(", ");
  return new HttpError(405, "METHOD_NOT_ALLOWED", `allowed methods: ${allow}`, { allow });
}

export function payloadTooLarge(limitBytes: number): HttpError {
  return new HttpError(413, "PAYLOAD_TOO_LARGE", `the JSON body must not exceed ${limitBytes} bytes`);
}

export function unsupportedMediaType(): HttpError {
  return new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "the request body must use content-type application/json");
}

export function serviceUnavailable(message = "a service dependency is unavailable"): HttpError {
  return new HttpError(503, "SERVICE_UNAVAILABLE", message);
}
