// P6-10 (integration fix): the platform's session probe returns only the
// contract account id, so the web UI has no trusted display name or e-mail in
// the automated test-mode environment (real Kratos sessions still carry both).
// A short account-id fragment is an honest fallback, never an invented name.

export interface AccountIdentity {
  readonly accountId: string;
  readonly email?: string;
  readonly displayName?: string;
}

/** Display name, else e-mail, else a short deterministic account-id fragment. */
export function accountLabel(identity: AccountIdentity): string {
  const displayName = identity.displayName?.trim() ?? "";
  if (displayName !== "") {
    return displayName;
  }
  const email = identity.email?.trim() ?? "";
  if (email !== "") {
    return email;
  }
  const compact = identity.accountId.replace(/[^A-Za-z0-9]/g, "");
  if (compact.length === 0) {
    return "?";
  }
  return compact.slice(-8).toUpperCase();
}
