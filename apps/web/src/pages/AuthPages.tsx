import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { api } from "../auth/client.ts";
import { errorMessageKey, validateLogin, validateRecovery, validateRegistration, type FieldErrors } from "../auth/validation.ts";
import { Button } from "../components/Button.tsx";

interface AuthPageProps { readonly t: (key: string) => string; readonly onSignedIn: () => Promise<void>; }

export function LoginPage({ t, onSignedIn }: AuthPageProps) {
  const navigate = useNavigate(); const location = useLocation();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({}); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const next = new URLSearchParams(location.search).get("next") ?? "/boards";
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    const found = validateLogin({ email, password }); setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try { await api.auth.login(email, password); await onSignedIn(); void navigate(next, { replace: true }); }
    catch (caught) { setError(t(errorMessageKey(caught))); }
    finally { setPending(false); }
  };
  return (
    <section className="page auth-card">
      <h1 className="page-title">{t("auth.login.title")}</h1>
      <form className="form" onSubmit={(event) => { void submit(event); }} noValidate>
        <label className="field"><span>{t("auth.email")}</span><input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={errors["email"] !== undefined} /></label>
        {errors["email"] === undefined ? null : <p className="field-error">{t(errors["email"])}</p>}
        <label className="field"><span>{t("auth.password")}</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} aria-invalid={errors["password"] !== undefined} /></label>
        {errors["password"] === undefined ? null : <p className="field-error">{t(errors["password"])}</p>}
        {error === null ? null : <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={pending}>{pending ? t("auth.signingIn") : t("auth.signIn")}</Button>
        <div className="auth-links"><Link to="/recovery" className="text-link">{t("auth.forgotPassword")}</Link><Link to="/register" className="text-link">{t("auth.createAccount")}</Link></div>
      </form>
    </section>
  );
}

export function RegisterPage({ t, onSignedIn }: AuthPageProps) {
  const navigate = useNavigate();
  const [email, setEmail] = useState(""); const [displayName, setDisplayName] = useState(""); const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({}); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    const found = validateRegistration({ email, displayName, password }); setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try { await api.auth.registration({ email, displayName, password }); await onSignedIn(); void navigate("/boards", { replace: true }); }
    catch (caught) { setError(t(errorMessageKey(caught))); }
    finally { setPending(false); }
  };
  return (
    <section className="page auth-card">
      <h1 className="page-title">{t("auth.register.title")}</h1>
      <form className="form" onSubmit={(event) => { void submit(event); }} noValidate>
        <label className="field"><span>{t("auth.email")}</span><input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        {errors["email"] === undefined ? null : <p className="field-error">{t(errors["email"])}</p>}
        <label className="field"><span>{t("auth.displayName")}</span><input className="input" type="text" autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        {errors["displayName"] === undefined ? null : <p className="field-error">{t(errors["displayName"])}</p>}
        <label className="field"><span>{t("auth.password")}</span><input className="input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {errors["password"] === undefined ? null : <p className="field-error">{t(errors["password"])}</p>}
        {error === null ? null : <p className="form-error" role="alert">{error}</p>}
        <Button type="submit" variant="primary" disabled={pending}>{pending ? t("auth.registering") : t("auth.register.submit")}</Button>
        <Link to="/login" className="text-link">{t("auth.backToSignIn")}</Link>
      </form>
    </section>
  );
}

export function RecoveryPage({ t }: { readonly t: (key: string) => string }) {
  const [email, setEmail] = useState(""); const [errors, setErrors] = useState<FieldErrors>({}); const [pending, setPending] = useState(false); const [sent, setSent] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null);
    const found = validateRecovery({ email }); setErrors(found);
    if (Object.keys(found).length > 0) return;
    setPending(true);
    try { await api.auth.recovery(email); setSent(true); } catch (caught) { setError(t(errorMessageKey(caught))); } finally { setPending(false); }
  };
  return (
    <section className="page auth-card">
      <h1 className="page-title">{t("auth.recovery.title")}</h1>
      {sent ? <p className="muted">{t("auth.recovery.sent")}</p> : (
        <form className="form" onSubmit={(event) => { void submit(event); }} noValidate>
          <p className="muted small">{t("auth.recovery.hint")}</p>
          <label className="field"><span>{t("auth.email")}</span><input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          {errors["email"] === undefined ? null : <p className="field-error">{t(errors["email"])}</p>}
          {error === null ? null : <p className="form-error" role="alert">{error}</p>}
          <Button type="submit" variant="primary" disabled={pending}>{pending ? t("auth.recovery.sending") : t("auth.recovery.submit")}</Button>
          <Link to="/login" className="text-link">{t("auth.backToSignIn")}</Link>
        </form>
      )}
    </section>
  );
}
