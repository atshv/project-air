// P6-02: client-side validation mirrors the server rules for quick feedback
// (server-side validation stays authoritative). Pure functions, node --test.
export type FieldErrors = Readonly<Record<string, string>>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;
export function validateEmail(value: string): boolean { return value.length > 0 && value.length <= 254 && EMAIL.test(value.trim()); }
export function validatePassword(value: string): boolean { return value.length >= MIN_PASSWORD_LENGTH; }
export function validateDisplayName(value: string): boolean { const length = value.trim().length; return length > 0 && length <= 120; }
export function validateLogin(input: { email: string; password: string }): FieldErrors {
  const errors: Record<string, string> = {};
  if (!validateEmail(input.email)) errors["email"] = "auth.validation.email";
  if (input.password.length === 0) errors["password"] = "auth.validation.password";
  return errors;
}
export function validateRegistration(input: { email: string; password: string; displayName: string }): FieldErrors {
  const errors: Record<string, string> = { ...validateLogin(input) };
  if (!validatePassword(input.password)) errors["password"] = "auth.validation.passwordLength";
  if (!validateDisplayName(input.displayName)) errors["displayName"] = "auth.validation.displayName";
  return errors;
}
export function validateRecovery(input: { email: string }): FieldErrors { return validateEmail(input.email) ? {} : { email: "auth.validation.email" }; }
export function errorMessageKey(error: unknown): string {
  if (error !== null && typeof error === "object" && "messageKey" in error && typeof error.messageKey === "string") return error.messageKey;
  if (error !== null && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const map: Record<string, string> = { AUTH_REQUIRED: "errors.authRequired", VALIDATION: "errors.validation", CONFLICT: "errors.conflict", RATE_LIMITED: "errors.rateLimited", INTERNAL: "errors.internal" };
    return map[error.code] ?? "errors.generic";
  }
  return "errors.generic";
}
