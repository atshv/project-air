/**
 * P6-02: JSON auth routes over the existing Kratos client. The service creates
 * and submits the provider flow in one call (the browser never sees the flow
 * object or CSRF token), forwards/creates the HttpOnly session cookie and maps
 * provider failures to the contract error codes. Credentials and tokens are
 * never logged or echoed.
 */
import { authRequired, conflict, internalError, serviceUnavailable, validationFailed } from "./http/errors.ts";
import type { Router } from "./http/router.ts";
import { KratosError, type KratosClient } from "./kratos.ts";

export const SESSION_COOKIE = "ory_kratos_session";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const MAX_EMAIL_LENGTH = 254;
const MAX_NAME_LENGTH = 120;

export interface AuthRoutesOptions {
  readonly kratos: KratosClient;
  /** `Secure` on the session cookie in production. */
  readonly cookieSecure?: boolean;
}

function cookie(secure: boolean, value: string, maxAgeSeconds?: number): string {
  const parts = [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join("; ");
}

function readString(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === "string" ? value.trim() : "";
}

function validateEmail(email: string): boolean {
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email);
}

function mapError(error: unknown): never {
  if (error instanceof KratosError) {
    if (error.code === "unauthorized") throw authRequired("invalid credentials");
    if (error.code === "conflict") throw conflict("the account already exists");
    if (error.code === "unavailable") throw serviceUnavailable("the identity provider is not reachable");
    if (error.code === "bad_response") throw internalError("the identity provider returned an invalid response");
    throw serviceUnavailable("the identity provider is not reachable");
  }
  throw error;
}

export function registerAuthRoutes(router: Router, options: AuthRoutesOptions): void {
  const secure = options.cookieSecure ?? false;
  router.post("/v1/auth/login", async (context) => {
    const body = await context.readJson<Record<string, unknown>>();
    const email = readString(body, "email");
    const password = typeof body["password"] === "string" ? body["password"] : "";
    if (!validateEmail(email) || password.length < MIN_PASSWORD_LENGTH) {
      throw validationFailed(["email", "password"]);
    }
    try {
      const flow = await options.kratos.loginFlow();
      const result = await options.kratos.submitLogin(flow.id, email, password);
      const setCookie = result.setCookie.length > 0 ? result.setCookie : (result.sessionToken === null ? [] : [cookie(secure, result.sessionToken)]);
      return { status: 200, data: { signedIn: true }, ...(setCookie.length === 0 ? {} : { headers: { "set-cookie": setCookie.join(", ") } }) };
    } catch (error) {
      mapError(error);
    }
  });

  router.post("/v1/auth/registration", async (context) => {
    const body = await context.readJson<Record<string, unknown>>();
    const email = readString(body, "email");
    const password = typeof body["password"] === "string" ? body["password"] : "";
    const displayName = readString(body, "displayName");
    if (!validateEmail(email) || password.length < MIN_PASSWORD_LENGTH || displayName.length === 0 || displayName.length > MAX_NAME_LENGTH) {
      throw validationFailed(["email", "password", "displayName"]);
    }
    try {
      const flow = await options.kratos.registrationFlow();
      const result = await options.kratos.submitRegistration(flow.id, { email, password, displayName });
      const setCookie = result.setCookie.length > 0 ? result.setCookie : (result.sessionToken === null ? [] : [cookie(secure, result.sessionToken)]);
      return { status: 201, data: { registered: true, displayName }, ...(setCookie.length === 0 ? {} : { headers: { "set-cookie": setCookie.join(", ") } }) };
    } catch (error) {
      mapError(error);
    }
  });

  router.post("/v1/auth/recovery", async (context) => {
    const body = await context.readJson<Record<string, unknown>>();
    const email = readString(body, "email");
    if (!validateEmail(email)) throw validationFailed(["email"]);
    try {
      const flow = await options.kratos.recoveryFlow();
      await options.kratos.submitRecovery(flow.id, email);
      return { status: 200, data: { sent: true } };
    } catch (error) {
      mapError(error);
    }
  });

  router.post("/v1/auth/logout", async (context) => {
    const raw = context.headers.cookie;
    const cookieHeader = typeof raw === "string" ? raw.trim() : "";
    if (cookieHeader !== "") await options.kratos.logout(cookieHeader);
    return { status: 200, data: { signedOut: true }, headers: { "set-cookie": cookie(secure, "", 0) } };
  });
}
