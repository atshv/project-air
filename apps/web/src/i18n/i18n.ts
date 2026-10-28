// P6-01: one message loader over apps/web/messages with German as the default,
// persisted language choice and <html lang> updates. Pure functions accept the
// catalogs/storage so node --test can exercise them without a DOM.

export type Language = "de" | "en";
export type MessageCatalog = { readonly [key: string]: string | MessageCatalog };
export type Translate = (key: string, values?: Readonly<Record<string, string | number>>) => string;

export const DEFAULT_LANGUAGE: Language = "de";
export const STORAGE_KEY = "project-air.language";
export const LANGUAGES: readonly Language[] = ["de", "en"];

function lookup(catalog: MessageCatalog, key: string): string | undefined {
  let node: string | MessageCatalog = catalog;
  for (const segment of key.split(".")) {
    if (typeof node === "string") return undefined;
    const next: string | MessageCatalog | undefined = node[segment];
    if (next === undefined) return undefined;
    node = next;
  }
  return typeof node === "string" ? node : undefined;
}

export function createTranslate(catalog: MessageCatalog): Translate {
  return (key, values = {}) => {
    const template = lookup(catalog, key);
    if (template === undefined) return key;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (values[name] === undefined ? match : String(values[name])));
  };
}

export function isLanguage(value: unknown): value is Language {
  return value === "de" || value === "en";
}

export function readStoredLanguage(storage: { getItem(key: string): string | null } | null | undefined): Language {
  try {
    const value = storage?.getItem(STORAGE_KEY) ?? null;
    return isLanguage(value) ? value : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function persistLanguage(storage: { setItem(key: string, value: string): void } | null | undefined, language: Language): void {
  try { storage?.setItem(STORAGE_KEY, language); } catch { /* storage may be unavailable */ }
}

export function messageKeys(catalog: MessageCatalog, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [name, value] of Object.entries(catalog)) {
    const key = prefix.length === 0 ? name : `${prefix}.${name}`;
    if (typeof value === "string") keys.push(key);
    else keys.push(...messageKeys(value, key));
  }
  return keys.sort();
}

export function catalogParity(left: MessageCatalog, right: MessageCatalog): { missingInRight: string[]; missingInLeft: string[] } {
  const leftKeys = new Set(messageKeys(left));
  const rightKeys = new Set(messageKeys(right));
  return {
    missingInRight: [...leftKeys].filter((key) => !rightKeys.has(key)).sort(),
    missingInLeft: [...rightKeys].filter((key) => !leftKeys.has(key)).sort(),
  };
}
