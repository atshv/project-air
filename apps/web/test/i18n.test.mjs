import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  catalogParity, createTranslate, DEFAULT_LANGUAGE, isLanguage, messageKeys, persistLanguage,
  readStoredLanguage, STORAGE_KEY,
} from "../src/i18n/i18n.ts";

const de = JSON.parse(readFileSync(new URL("../messages/de.json", import.meta.url), "utf8"));
const en = JSON.parse(readFileSync(new URL("../messages/en.json", import.meta.url), "utf8"));

test("en and de catalogs have identical key sets", () => {
  assert.deepEqual(catalogParity(de, en), { missingInRight: [], missingInLeft: [] });
  assert.ok(messageKeys(de).length > 0);
});

test("translate resolves nested keys and interpolates values", () => {
  const t = createTranslate(en);
  assert.equal(t("app.name"), "Project air");
  assert.equal(t("missing.key"), "missing.key");
});

test("German is the default and a stored choice persists", () => {
  assert.equal(DEFAULT_LANGUAGE, "de");
  assert.equal(readStoredLanguage(null), "de");
  const values = new Map();
  persistLanguage({ setItem: (key, value) => values.set(key, value) }, "en");
  assert.equal(values.get(STORAGE_KEY), "en");
  assert.equal(readStoredLanguage({ getItem: (key) => values.get(key) ?? null }), "en");
  assert.equal(isLanguage("fr"), false);
  assert.equal(isLanguage(undefined), false);
});
