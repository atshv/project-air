import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";

import de from "../messages/de.json";
import en from "../messages/en.json";
import { api } from "./auth/client.ts";
import type { SessionUser } from "../../../packages/sdk/src/auth.ts";
import { LoginPage, RecoveryPage, RegisterPage } from "./pages/AuthPages.tsx";
import { BoardPageGuard, BoardsPage } from "./pages/BoardsPage.tsx";
import { Button } from "./components/Button.tsx";
import { catalogParity, createTranslate, DEFAULT_LANGUAGE, LANGUAGES, persistLanguage, readStoredLanguage, type Language, type MessageCatalog } from "./i18n/i18n.ts";
import { ROUTES } from "./routes.ts";

const catalogs: Record<Language, MessageCatalog> = { de: de as unknown as MessageCatalog, en: en as unknown as MessageCatalog };
const LANGUAGE_NAMES: Record<Language, string> = { de: "language.de", en: "language.en" };

type SessionState = { readonly loading: boolean; readonly user: SessionUser | null; readonly errorKey: string | null };

function EmptyRoute({ titleKey, bodyKey, t }: { readonly titleKey: string; readonly bodyKey: string; readonly t: (key: string) => string }) {
  return (
    <section className="empty-state" aria-labelledby="empty-heading">
      <p className="eyebrow">{t("emptyState.heading")}</p>
      <h1 id="empty-heading" className="page-title">{t(titleKey)}</h1>
      <p className="muted">{t(bodyKey)}</p>
      <p className="muted small">{t("emptyState.description")}</p>
    </section>
  );
}

function StartPage({ t, signedIn }: { readonly t: (key: string) => string; readonly signedIn: boolean }) {
  return (
    <section className="page">
      <p className="eyebrow">{t("nav.start")}</p>
      <h1 className="page-title">{t("routes.start.title")}</h1>
      <p className="lead">{t("app.tagline")}</p>
      <p className="muted">{t("routes.start.body")}</p>
      <Link className="text-link" to={signedIn ? "/boards" : "/login"}>{signedIn ? t("nav.boards") : t("auth.signIn")}</Link>
    </section>
  );
}

function SettingsPage({ t, language, setLanguage, user, onSignOut }: { readonly t: (key: string) => string; readonly language: Language; readonly setLanguage: (language: Language) => void; readonly user: SessionUser | null; readonly onSignOut: () => Promise<void> }) {
  return (
    <section className="page">
      <h1 className="page-title">{t("routes.settings.title")}</h1>
      <h2 className="section-title">{t("settings.account")}</h2>
      {user === null ? <p className="muted">{t("auth.signedOut")}</p> : (
        <>
          <p className="muted small">{t("settings.signedInAs")}: {user.displayName} ({user.email})</p>
          <Button variant="secondary" onClick={() => { void onSignOut(); }}>{t("auth.signOut")}</Button>
        </>
      )}
      <h2 className="section-title">{t("settings.language")}</h2>
      <p className="muted small">{t("settings.languageHint")}</p>
      <div className="button-row" role="group" aria-label={t("language.label")}>
        {LANGUAGES.map((candidate) => (
          <Button key={candidate} variant={candidate === language ? "primary" : "secondary"} onClick={() => setLanguage(candidate)} aria-pressed={candidate === language}>{t(LANGUAGE_NAMES[candidate])}</Button>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [language, setLanguageState] = useState<Language>(() => {
    try { return readStoredLanguage(globalThis.localStorage); } catch { return DEFAULT_LANGUAGE; }
  });
  const [session, setSession] = useState<SessionState>({ loading: true, user: null, errorKey: null });
  const location = useLocation(); const navigate = useNavigate();
  const t = useMemo(() => createTranslate(catalogs[language]), [language]);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try { persistLanguage(globalThis.localStorage, next); } catch { /* storage may be unavailable */ }
  }, []);
  const refreshSession = useCallback(async () => {
    try {
      const user = await api.auth.getSession();
      setSession({ loading: false, user, errorKey: null });
    } catch (error) {
      const key = error !== null && typeof error === "object" && "status" in error && error.status === 401 ? null : "errors.generic";
      setSession({ loading: false, user: null, errorKey: key });
    }
  }, []);
  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = createTranslate(catalogs[language])("app.name");
  }, [language]);
  const parity = useMemo(() => catalogParity(catalogs.de, catalogs.en), []);
  if (parity.missingInRight.length > 0 || parity.missingInLeft.length > 0) throw new Error("translation catalogs differ");
  const signOut = useCallback(async () => { try { await api.auth.logout(); } finally { setSession({ loading: false, user: null, errorKey: null }); navigate("/login", { replace: true }); } }, [navigate]);
  const signIn = useCallback(async () => { await refreshSession(); }, [refreshSession]);
  const requireAuth = (element: ReactElement): ReactElement => {
    if (session.loading) return <section className="page" aria-busy="true"><p className="muted">{t("auth.checkingSession")}</p></section>;
    if (session.user === null) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
    return element;
  };
  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link className="brand" to="/">{t("app.name")}</Link>
        <nav className="nav" aria-label={t("nav.label")}>
          <NavLink className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")} to="/boards">{t("nav.boards")}</NavLink>
          <NavLink className={({ isActive }) => (isActive ? "nav-link active" : "nav-link")} to="/settings">{t("nav.settings")}</NavLink>
        </nav>
        <div className="top-bar-actions">
          <div className="button-row" role="group" aria-label={t("language.label")}>
            {LANGUAGES.map((candidate) => (
              <Button key={candidate} variant="ghost" size="card" onClick={() => setLanguage(candidate)} aria-pressed={candidate === language}>{candidate.toUpperCase()}</Button>
            ))}
          </div>
          {session.user === null ? (
            <span className="account muted" aria-label={t("auth.signedOut")}>{t("auth.signedOut")}</span>
          ) : (
            <>
              <span className="account" aria-label={t("auth.signedInAs")}>{session.user.displayName}</span>
              <Button variant="secondary" size="card" onClick={() => { void signOut(); }}>{t("auth.signOut")}</Button>
            </>
          )}
        </div>
      </header>
      <main className="main">
        {session.errorKey === null ? null : <p className="form-error" role="alert">{t(session.errorKey)}</p>}
        <Routes>
          <Route path="/" element={<StartPage t={t} signedIn={session.user !== null} />} />
          <Route path="/login" element={<LoginPage t={t} onSignedIn={signIn} />} />
          <Route path="/register" element={<RegisterPage t={t} onSignedIn={signIn} />} />
          <Route path="/recovery" element={<RecoveryPage t={t} />} />
          <Route path="/boards" element={requireAuth(<BoardsPage t={t} language={language} accountId={session.user?.accountId ?? ""} />)} />
          <Route path="/boards/:id" element={requireAuth(<BoardPageGuard t={t} />)} />
          <Route path="/settings" element={requireAuth(<SettingsPage t={t} language={language} setLanguage={setLanguage} user={session.user} onSignOut={signOut} />)} />
          <Route path="*" element={<EmptyRoute titleKey="routes.boards.title" bodyKey="routes.boards.body" t={t} />} />
        </Routes>
      </main>
    </div>
  );
}

export const __routes = ROUTES;
