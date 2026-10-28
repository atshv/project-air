import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router";

import de from "../messages/de.json";
import en from "../messages/en.json";
import { catalogParity, createTranslate, DEFAULT_LANGUAGE, LANGUAGES, persistLanguage, readStoredLanguage, type Language, type MessageCatalog } from "./i18n/i18n.ts";
import { ROUTES, boardPath } from "./routes.ts";
import { Button } from "./components/Button.tsx";

const catalogs: Record<Language, MessageCatalog> = { de: de as unknown as MessageCatalog, en: en as unknown as MessageCatalog };
const LANGUAGE_NAMES: Record<Language, string> = { de: "language.de", en: "language.en" };

function EmptyRoute({ titleKey, bodyKey }: { readonly titleKey: string; readonly bodyKey: string }) {
  const { t } = useAppI18n();
  return (
    <section className="empty-state" aria-labelledby="empty-heading">
      <p className="eyebrow">{t("emptyState.heading")}</p>
      <h1 id="empty-heading" className="page-title">{t(titleKey)}</h1>
      <p className="muted">{t(bodyKey)}</p>
      <p className="muted small">{t("emptyState.description")}</p>
    </section>
  );
}

interface AppI18n {
  readonly language: Language;
  readonly t: ReturnType<typeof createTranslate>;
  readonly setLanguage: (language: Language) => void;
}
const I18nContext = { current: null as AppI18n | null };
export function useAppI18n(): AppI18n {
  if (I18nContext.current === null) throw new Error("i18n context missing");
  return I18nContext.current;
}

function StartPage() {
  const { t } = useAppI18n();
  return (
    <section className="page">
      <p className="eyebrow">{t("nav.start")}</p>
      <h1 className="page-title">{t("routes.start.title")}</h1>
      <p className="lead">{t("app.tagline")}</p>
      <p className="muted">{t("routes.start.body")}</p>
      <Link className="text-link" to={boardPath("")}>{t("nav.boards")}</Link>
    </section>
  );
}

function SettingsPage() {
  const { t, language, setLanguage } = useAppI18n();
  return (
    <section className="page">
      <h1 className="page-title">{t("routes.settings.title")}</h1>
      <p className="muted">{t("routes.settings.body")}</p>
      <h2 className="section-title">{t("settings.language")}</h2>
      <p className="muted small">{t("settings.languageHint")}</p>
      <div className="button-row" role="group" aria-label={t("language.label")}>
        {LANGUAGES.map((candidate) => (
          <Button key={candidate} variant={candidate === language ? "primary" : "secondary"} onClick={() => setLanguage(candidate)} aria-pressed={candidate === language}>
            {t(LANGUAGE_NAMES[candidate])}
          </Button>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [language, setLanguageState] = useState<Language>(() => {
    try { return readStoredLanguage(globalThis.localStorage); } catch { return DEFAULT_LANGUAGE; }
  });
  const t = useMemo(() => createTranslate(catalogs[language]), [language]);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try { persistLanguage(globalThis.localStorage, next); } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = createTranslate(catalogs[language])("app.name");
  }, [language]);
  const context = useMemo<AppI18n>(() => ({ language, t, setLanguage }), [language, setLanguage, t]);
  I18nContext.current = context;
  const parity = useMemo(() => catalogParity(catalogs.de, catalogs.en), []);
  if (parity.missingInRight.length > 0 || parity.missingInLeft.length > 0) {
    throw new Error(`translation catalogs differ: ${[...parity.missingInRight, ...parity.missingInLeft].join(", ")}`);
  }
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
              <Button key={candidate} variant="ghost" size="card" onClick={() => setLanguage(candidate)} aria-pressed={candidate === language}>
                {candidate.toUpperCase()}
              </Button>
            ))}
          </div>
          <span className="account muted" aria-label={t("auth.signedOut")}>{t("auth.signedOut")}</span>
          <Button variant="secondary" size="card">{t("auth.signIn")}</Button>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<StartPage />} />
          <Route path="/login" element={<EmptyRoute titleKey="routes.login.title" bodyKey="routes.login.body" />} />
          <Route path="/boards" element={<EmptyRoute titleKey="routes.boards.title" bodyKey="routes.boards.body" />} />
          <Route path="/boards/:id" element={<EmptyRoute titleKey="routes.board.title" bodyKey="routes.board.body" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<EmptyRoute titleKey="routes.boards.title" bodyKey="routes.boards.body" />} />
        </Routes>
      </main>
    </div>
  );
}

export const __routes = ROUTES;
