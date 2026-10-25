/**
 * `POST /internal/invitations`: create an invited identity through the Kratos
 * admin API.
 *
 * The route is internal and protected by the shared admin token
 * (`KRATOS_ADMIN_TOKEN`, bearer); the platform (P3-04) calls it, not the
 * browser. It creates only the Kratos identity and returns its id; the
 * workspace invitation itself is created by the platform.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { isRecord, stringValue } from "./http/body.ts";
import { authRequired, conflict, serviceUnavailable, validationFailed } from "./http/errors.ts";
import type { Router } from "./http/router.ts";
import { KratosError, type KratosClient } from "./kratos.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;
const MAX_DISPLAY_NAME_LENGTH = 80;
const DEFAULT_LOCALE = "de";

export interface InvitationOptions {
  readonly kratos: KratosClient;
  /** Shared secret from `KRATOS_ADMIN_TOKEN`; never logged. */
  readonly adminToken: string;
}

interface Invitation {
  readonly email: string;
  readonly displayName: string;
  readonly locale: string;
}

/** Constant-time comparison of two tokens of any length. */
export function tokensMatch(provided: string | undefined, expected: string): boolean {
  if (provided === undefined || provided === "") {
    return false;
  }
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function bearerToken(authorization: string | undefined): string | undefined {
  if (authorization === undefined) {
    return undefined;
  }
  const match = /^Bearer[ ]+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim();
}

function parseInvitation(body: unknown): { invitation: Invitation } | { fields: readonly string[] } {
  if (!isRecord(body)) {
    return { fields: ["email", "displayName"] };
  }
  const rawEmail = stringValue(body, "email")?.trim() ?? "";
  const rawDisplayName = stringValue(body, "displayName")?.trim() ?? "";
  const rawLocale = stringValue(body, "locale")?.trim();
  const fields: string[] = [];
  if (rawEmail === "" || rawEmail.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(rawEmail)) {
    fields.push("email");
  }
  if (rawDisplayName === "" || rawDisplayName.length > MAX_DISPLAY_NAME_LENGTH) {
    fields.push("displayName");
  }
  if (rawLocale !== undefined && rawLocale !== "de" && rawLocale !== "en") {
    fields.push("locale");
  }
  if (fields.length > 0) {
    return { fields };
  }
  return { invitation: { email: rawEmail, displayName: rawDisplayName, locale: rawLocale ?? DEFAULT_LOCALE } };
}

export function registerInvitationRoutes(router: Router, options: InvitationOptions): void {
  router.post("/internal/invitations", async (context) => {
    const authorization = context.headers.authorization;
    if (!tokensMatch(bearerToken(typeof authorization === "string" ? authorization : undefined), options.adminToken)) {
      throw authRequired("the admin token is missing or invalid");
    }

    const parsed = parseInvitation(await context.readJson<unknown>());
    if ("fields" in parsed) {
      throw validationFailed(parsed.fields);
    }
    const invitation = parsed.invitation;

    let identityId: string;
    try {
      const identity = await options.kratos.createIdentity({
        email: invitation.email,
        displayName: invitation.displayName,
        locale: invitation.locale,
      });
      identityId = identity.id;
    } catch (error) {
      if (error instanceof KratosError) {
        if (error.code === "conflict") {
          throw conflict("an account with this e-mail already exists");
        }
        throw serviceUnavailable("the identity server is not reachable");
      }
      throw error;
    }

    return { status: 201, data: { identityId, email: invitation.email } };
  });
}
