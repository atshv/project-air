/**
 * P6-10: Playwright fixtures for the web e2e suite.
 *
 * Authentication is the gated test-mode session, not Kratos: the harness mints
 * an HMAC test session per seeded account and the browser context carries it as
 * the non-HttpOnly `air_e2e_session` cookie. The e2e server (tools/dev) turns
 * that cookie into the auth service's `x-test-session` header for `/v1` HTTP
 * requests and strips it from the sync upgrade, where the page init script below
 * fills the contract hello `tokenRef` with the same token (a browser WebSocket
 * cannot set an auth header; the tokenRef path is the protocol's documented
 * test/non-browser path and the auth service accepts it only with
 * AUTH_TEST_MODE=1). No production path is weakened by this.
 */

import { test as base, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { TEST_SESSION_COOKIE, e2eEnvironment, type E2eAccount } from "./env.ts";

/** Fills the contract hello `tokenRef` from the e2e session cookie (test mode only). */
const SESSION_TOKEN_REF_INIT_SCRIPT = `(() => {
  const readToken = () => {
    const match = document.cookie.match(/(?:^|;\\s*)${TEST_SESSION_COOKIE}=([^;]+)/);
    return match === null ? null : match[1];
  };
  const originalSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string") {
        const message = JSON.parse(data);
        if (message !== null && typeof message === "object" && message.type === "hello" && message.payload !== null && typeof message.payload === "object") {
          const token = readToken();
          if (token !== null && token !== "") {
            message.payload.tokenRef = token;
            data = JSON.stringify(message);
          }
        }
      }
    } catch (error) {
      // Keep the original frame when it is not the JSON hello.
    }
    return originalSend.call(this, data);
  };
})();`;

export interface AppSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly account: E2eAccount;
}

/** English labels for stable role/name selectors (the app defaults to German). */
const ENGLISH_INIT_SCRIPT = `try { localStorage.setItem("project-air.language", "en"); } catch (error) { /* storage unavailable */ }`;

export async function openSession(browser: Browser, account: E2eAccount): Promise<AppSession> {
  const environment = e2eEnvironment();
  const context = await browser.newContext({
    baseURL: environment.baseURL,
    viewport: { width: 1440, height: 900 },
  });
  await context.addCookies([{ name: TEST_SESSION_COOKIE, value: account.token, url: environment.baseURL }]);
  await context.addInitScript({ content: ENGLISH_INIT_SCRIPT });
  await context.addInitScript({ content: SESSION_TOKEN_REF_INIT_SCRIPT });
  const page = await context.newPage();
  return { context, page, account };
}

/** A clean context with no test session: the logged-out user of the guard spec. */
export async function openAnonymousSession(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: e2eEnvironment().baseURL,
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript({ content: ENGLISH_INIT_SCRIPT });
  await context.addInitScript({ content: SESSION_TOKEN_REF_INIT_SCRIPT });
  return { context, page: await context.newPage() };
}

/**
 * `alpha`/`beta` are two signed-in accounts on the seeded workspace. Tests that
 * only need one session use `alpha`; the realtime spec uses both (distinct
 * account ids, so presence and authorship are genuinely two clients).
 */
export const test = base.extend<{ alpha: AppSession; beta: AppSession }>({
  alpha: async ({ browser }, use) => {
    const session = await openSession(browser, e2eEnvironment().accounts[0]!);
    await use(session);
    await session.context.close();
  },
  beta: async ({ browser }, use) => {
    const session = await openSession(browser, e2eEnvironment().accounts[1]!);
    await use(session);
    await session.context.close();
  },
});

export { expect };
