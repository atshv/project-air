#!/usr/bin/env node
/**
 * language-check — the dependency-free language and translation gate for Project air.
 *
 * Usage:
 *   node tools/language-check/index.mjs [root] [--write-pseudo]
 *
 * [root] defaults to the current directory. The command checks the message catalogue in
 * `apps/web/messages/`, the i18n documents in `docs/i18n/` and user-facing strings in the
 * scanned code roots. Findings use the format `file:line: rule: message`.
 *
 * Exit codes: 0 clean, 1 findings, 2 usage or configuration error.
 *
 * Node.js builtins only. The German word list lives in `german-words.json` next to this file.
 * This tool never writes outside the message directory; `--write-pseudo` regenerates `en-XA.json`.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORD_LIST_FILE = join(HERE, 'german-words.json');

const MESSAGE_DIR = 'apps/web/messages';
const I18N_DIR = 'docs/i18n';
const MESSAGE_FILES = ['de.json', 'en.json', 'en-XA.json'];
const PSEUDO_LOCALE = 'en-XA';

const SCAN_ROOTS = ['apps', 'packages/editor', 'packages/ui-kit', 'tools'];
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.css']);
const SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', '.turbo', 'dist', 'build', 'coverage', '.next',
  'reviews', 'reference',
]);
const SKIP_PATH_PREFIXES = ['tools/language-check/test/'];

const KEY_SEGMENT = /^[a-z][a-zA-Z0-9]*$/;
const UMLAUTS = /[äöüÄÖÜ]/;
const SHARP_S = String.fromCharCode(0x00df); // U+00DF, spelled without the literal so this file passes its own rule

class Finding {
  constructor(file, root, line, rule, message) {
    this.file = file;
    this.rel = toPosix(relative(root, file));
    this.line = line;
    this.rule = rule;
    this.message = message;
  }
}

class IcuError extends Error {
  constructor(message, rule = 'icu-syntax') {
    super(message);
    this.rule = rule;
  }
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  let root = null;
  let writePseudo = false;
  for (const arg of argv) {
    if (arg === '--write-pseudo') {
      writePseudo = true;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg.startsWith('-')) {
      return { error: `unknown option: ${arg}` };
    } else if (root === null) {
      root = arg;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { root: root ?? '.', writePseudo };
}

function printUsage() {
  console.log('usage: node tools/language-check/index.mjs [root] [--write-pseudo]');
  console.log('  root           project root, defaults to the current directory');
  console.log('  --write-pseudo regenerate apps/web/messages/en-XA.json from de.json');
}

function usageError(message) {
  console.error(`language-check: ${message}`);
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function toPosix(path) {
  return path.split('\\').join('/');
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function quote(value) {
  const compact = value.replace(/\s+/g, ' ').trim();
  const shortened = compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
  return `"${shortened}"`;
}

function readWordList() {
  if (!existsSync(WORD_LIST_FILE)) {
    usageError(`word list not found: ${relative(process.cwd(), WORD_LIST_FILE)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(WORD_LIST_FILE, 'utf8'));
  } catch (error) {
    usageError(`word list is not valid JSON: ${error.message}`);
  }
  const words = Array.isArray(parsed.words) ? parsed.words : [];
  if (words.length === 0 || words.some((word) => typeof word !== 'string')) {
    usageError('word list must contain a non-empty "words" array of strings');
  }
  return new Set(words.map((word) => word.toLowerCase()));
}

/* -------------------------------------------------------------------------- */
/* Message files                                                              */
/* -------------------------------------------------------------------------- */

function flattenMessages(data) {
  const flat = new Map();
  const invalid = [];
  const walk = (node, prefix) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      invalid.push({ path: prefix, value: node });
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      const path = [...prefix, key];
      if (typeof value === 'string') {
        flat.set(path.join('.'), { path, value });
      } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        walk(value, path);
      } else {
        invalid.push({ path, value });
      }
    }
  };
  walk(data, []);
  return { flat, invalid };
}

function lineForKey(text, path) {
  let from = 0;
  let line = 1;
  let found = false;
  for (const segment of path) {
    const index = text.indexOf(`"${segment}"`, from);
    if (index === -1) break;
    line = lineAt(text, index);
    from = index + segment.length + 2;
    found = true;
  }
  return found ? line : 1;
}

function loadMessages(root, writePseudo) {
  const directory = join(root, MESSAGE_DIR);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    usageError(`message directory not found: ${MESSAGE_DIR}`);
  }
  const locales = new Map();
  for (const name of MESSAGE_FILES) {
    const file = join(directory, name);
    if (!existsSync(file)) {
      if (name === 'en-XA.json' && writePseudo) continue;
      usageError(`message file not found: ${MESSAGE_DIR}/${name}`);
    }
    const text = readFileSync(file, 'utf8');
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      const lineMatch = /line (\d+)/.exec(error.message);
      locales.set(name.replace('.json', ''), {
        file, text, data: null,
        parseError: { line: lineMatch ? Number(lineMatch[1]) : 1, message: error.message },
      });
      continue;
    }
    locales.set(name.replace('.json', ''), { file, text, data, ...flattenMessages(data) });
  }
  return locales;
}

/* -------------------------------------------------------------------------- */
/* ICU MessageFormat parser                                                   */
/* -------------------------------------------------------------------------- */

class IcuParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    const nodes = this.parseMessage(false);
    if (this.index !== this.source.length) {
      throw new IcuError(`unexpected character at offset ${this.index}`);
    }
    validateBranches(nodes);
    return nodes;
  }

  parseMessage(nested) {
    const nodes = [];
    let text = '';
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === '{') {
        if (text) nodes.push({ type: 'text', text });
        text = '';
        nodes.push(this.parseArgument());
      } else if (char === '}') {
        if (!nested) throw new IcuError('unbalanced closing brace');
        if (text) nodes.push({ type: 'text', text });
        this.index += 1;
        return nodes;
      } else {
        text += char;
        this.index += 1;
      }
    }
    if (nested) throw new IcuError('unclosed opening brace');
    if (text) nodes.push({ type: 'text', text });
    return nodes;
  }

  skipWhitespace() {
    while (this.index < this.source.length && /\s/.test(this.source[this.index])) {
      this.index += 1;
    }
  }

  readIdentifier() {
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.source.slice(this.index));
    if (!match) throw new IcuError(`expected a name at offset ${this.index}`);
    this.index += match[0].length;
    return match[0];
  }

  readSelector() {
    const start = this.index;
    while (
      this.index < this.source.length &&
      !/[\s{},]/.test(this.source[this.index])
    ) {
      this.index += 1;
    }
    const selector = this.source.slice(start, this.index);
    if (!selector) throw new IcuError(`expected a selector at offset ${start}`);
    return selector;
  }

  parseArgument() {
    this.index += 1; // '{'
    this.skipWhitespace();
    const name = this.readIdentifier();
    this.skipWhitespace();
    if (this.index >= this.source.length) throw new IcuError('unclosed opening brace');
    if (this.source[this.index] === '}') {
      this.index += 1;
      return { type: 'argument', name, style: null };
    }
    if (this.source[this.index] !== ',') {
      throw new IcuError(`expected ',' after {${name}} at offset ${this.index}`);
    }
    this.index += 1;
    this.skipWhitespace();
    const styleType = this.readIdentifier();
    this.skipWhitespace();
    if (styleType === 'plural' || styleType === 'select') {
      if (this.source[this.index] !== ',') {
        throw new IcuError(`expected ',' after the ${styleType} type of {${name}}`);
      }
      this.index += 1;
      const branches = [];
      while (true) {
        this.skipWhitespace();
        if (this.index >= this.source.length) throw new IcuError('unclosed opening brace');
        if (this.source[this.index] === '}') {
          this.index += 1;
          break;
        }
        const selector = this.readSelector();
        this.skipWhitespace();
        if (this.source[this.index] !== '{') {
          throw new IcuError(`expected '{' after selector ${selector}`);
        }
        this.index += 1;
        const branchNodes = this.parseMessage(true);
        branches.push({ selector, nodes: branchNodes });
      }
      if (branches.length === 0) {
        throw new IcuError(`the ${styleType} of {${name}} has no branches`, 'icu-branches');
      }
      return { type: 'argument', name, style: { type: styleType, branches } };
    }
    if (!['number', 'date', 'time'].includes(styleType)) {
      throw new IcuError(`unsupported argument type "${styleType}" for {${name}}`);
    }
    let raw = '';
    while (this.index < this.source.length && this.source[this.index] !== '}') {
      if (this.source[this.index] === '{') {
        throw new IcuError(`the ${styleType} style of {${name}} may not contain braces`);
      }
      raw += this.source[this.index];
      this.index += 1;
    }
    if (this.index >= this.source.length) throw new IcuError('unclosed opening brace');
    this.index += 1;
    return { type: 'argument', name, style: { type: styleType, raw: raw.trim() } };
  }
}

function validateBranches(nodes) {
  for (const node of nodes) {
    if (node.type !== 'argument') continue;
    const style = node.style;
    if (!style || (style.type !== 'plural' && style.type !== 'select')) continue;
    const selectors = style.branches.map((branch) => branch.selector);
    if (new Set(selectors).size !== selectors.length) {
      throw new IcuError(`the ${style.type} of {${node.name}} has duplicate selectors`, 'icu-branches');
    }
    if (!selectors.includes('other')) {
      throw new IcuError(`the ${style.type} of {${node.name}} needs an "other" branch`, 'icu-branches');
    }
    if (style.type === 'plural' && !selectors.includes('one')) {
      throw new IcuError(`the plural of {${node.name}} needs a "one" branch`, 'icu-branches');
    }
    for (const branch of style.branches) validateBranches(branch.nodes);
  }
}

function collectArguments(nodes, names = new Set()) {
  for (const node of nodes) {
    if (node.type !== 'argument') continue;
    names.add(node.name);
    if (node.style && (node.style.type === 'plural' || node.style.type === 'select')) {
      for (const branch of node.style.branches) collectArguments(branch.nodes, names);
    }
  }
  return names;
}

function parseIcu(source) {
  return new IcuParser(source).parse();
}

/* -------------------------------------------------------------------------- */
/* Pseudo-locale                                                              */
/* -------------------------------------------------------------------------- */

const ACCENTS = {
  a: 'á', b: 'ƀ', c: 'ć', d: 'ď', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ',
  k: 'ķ', l: 'ĺ', m: 'ḿ', n: 'ñ', o: 'ó', p: 'ṕ', q: 'ʠ', r: 'ŕ', s: 'š', t: 'ţ',
  u: 'ú', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ý', z: 'ž',
  A: 'Á', B: 'Ɓ', C: 'Ć', D: 'Ď', E: 'É', F: 'Ƒ', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ',
  K: 'Ķ', L: 'Ĺ', M: 'Ḿ', N: 'Ñ', O: 'Ó', P: 'Ṕ', Q: 'Ɋ', R: 'Ŕ', S: 'Š', T: 'Ţ',
  U: 'Ú', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ý', Z: 'Ž',
};

function pseudoText(text) {
  let mapped = '';
  let letters = 0;
  for (const char of text) {
    const replacement = ACCENTS[char];
    if (replacement) {
      mapped += replacement;
      letters += 1;
    } else {
      mapped += char;
    }
  }
  if (letters === 0) return text;
  const padding = '·'.repeat(Math.ceil(letters * 0.4));
  return `[${mapped}${padding}]`;
}

function pseudoNodes(nodes) {
  return nodes.map((node) => {
    if (node.type === 'text') return { type: 'text', text: pseudoText(node.text) };
    if (node.style && (node.style.type === 'plural' || node.style.type === 'select')) {
      return {
        type: 'argument',
        name: node.name,
        style: {
          type: node.style.type,
          branches: node.style.branches.map((branch) => ({
            selector: branch.selector,
            nodes: pseudoNodes(branch.nodes),
          })),
        },
      };
    }
    return node;
  });
}

function serializeNodes(nodes) {
  return nodes.map(serializeNode).join('');
}

function serializeNode(node) {
  if (node.type === 'text') return node.text;
  if (node.style === null) return `{${node.name}}`;
  if (node.style.type === 'plural' || node.style.type === 'select') {
    const branches = node.style.branches
      .map((branch) => `${branch.selector} {${serializeNodes(branch.nodes)}}`)
      .join(' ');
    return `{${node.name}, ${node.style.type}, ${branches}}`;
  }
  const raw = node.style.raw ? `, ${node.style.raw}` : '';
  return `{${node.name}, ${node.style.type}${raw}}`;
}

function pseudoValue(value) {
  try {
    return serializeNodes(pseudoNodes(parseIcu(value)));
  } catch {
    return value; // invalid ICU is reported by the ICU check; keep the key stable
  }
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortDeep(value[key]);
    return sorted;
  }
  return value;
}

function setDeep(target, path, value) {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    cursor[segment] ??= {};
    cursor = cursor[segment];
  }
  cursor[path[path.length - 1]] = value;
}

function buildPseudo(data) {
  const { flat } = flattenMessages(data);
  const pseudo = {};
  for (const [key, entry] of flat) {
    setDeep(pseudo, entry.path, pseudoValue(entry.value));
    void key;
  }
  return sortDeep(pseudo);
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(sortDeep(value), null, 2)}\n`, 'utf8');
}

/* -------------------------------------------------------------------------- */
/* Checks on the message catalogue                                            */
/* -------------------------------------------------------------------------- */

function checkMessageCatalogue(root, locales, findings) {
  for (const name of ['de', 'en', 'en-XA']) {
    const locale = locales.get(name);
    if (!locale) continue;
    if (locale.data === null) {
      findings.push(new Finding(locale.file, root, locale.parseError.line, 'message-json',
        `${name}.json is not valid JSON: ${locale.parseError.message}`));
      continue;
    }
    for (const issue of locale.invalid) {
      findings.push(new Finding(locale.file, root, lineForKey(locale.text, issue.path), 'message-shape',
        `"${issue.path.join('.')}" must be a string, found ${typeof issue.value}`));
    }
    for (const key of locale.flat.keys()) {
      const segments = key.split('.');
      const bad = segments.find((segment) => !KEY_SEGMENT.test(segment) || UMLAUTS.test(segment));
      if (bad !== undefined) {
        const path = locale.flat.get(key).path;
        findings.push(new Finding(locale.file, root, lineForKey(locale.text, path), 'key-format',
          `key "${key}" has the invalid segment "${bad}"; use English lowerCamelCase`));
      }
    }
  }
  const de = locales.get('de');
  return de.data === null ? null : de;
}

function checkKeyParity(root, locales, de, findings) {
  const deKeys = [...de.flat.keys()].sort();
  for (const name of ['en', 'en-XA']) {
    const locale = locales.get(name);
    if (!locale || !locale.flat) continue;
    const localeKeys = new Set(locale.flat.keys());
    for (const key of deKeys) {
      if (!localeKeys.has(key)) {
        const path = de.flat.get(key).path;
        findings.push(new Finding(locale.file, root, lineForKey(locale.text, path), 'key-parity',
          `key "${key}" is missing in ${name}.json but present in de.json`));
      }
    }
    for (const key of localeKeys) {
      if (!de.flat.has(key)) {
        const path = locale.flat.get(key).path;
        findings.push(new Finding(locale.file, root, lineForKey(locale.text, path), 'key-parity',
          `key "${key}" is not defined in de.json`));
      }
    }
  }
}

function checkIcu(root, locales, de, findings) {
  const parsed = new Map();
  for (const [name, locale] of locales) {
    if (!locale || !locale.flat) continue;
    const map = new Map();
    for (const [key, entry] of locale.flat) {
      try {
        map.set(key, parseIcu(entry.value));
      } catch (error) {
        const rule = error instanceof IcuError ? error.rule : 'icu-syntax';
        findings.push(new Finding(locale.file, root, lineForKey(locale.text, entry.path), rule,
          `${key}: ${error.message}`));
      }
    }
    parsed.set(name, map);
  }

  const deParsed = parsed.get('de');
  if (!deParsed) return;
  for (const [key, deNodes] of deParsed) {
    const deArguments = [...collectArguments(deNodes)].sort();
    for (const name of ['en', 'en-XA']) {
      const locale = locales.get(name);
      const localeParsed = parsed.get(name);
      if (!locale || !locale.flat || !localeParsed || !localeParsed.has(key)) continue;
      const argumentsHere = [...collectArguments(localeParsed.get(key))].sort();
      if (deArguments.join(',') !== argumentsHere.join(',')) {
        const entry = locale.flat.get(key);
        findings.push(new Finding(locale.file, root, lineForKey(locale.text, entry.path),
          'icu-placeholders',
          `${key}: placeholders differ from de.json (de: ${formatSet(deArguments)}, ${name}: ${formatSet(argumentsHere)})`));
      }
    }
  }
}

function formatSet(values) {
  return values.length === 0 ? 'none' : `{${values.join(', ')}}`;
}

function checkPseudo(root, locales, de, writePseudo, findings, out) {
  const pseudo = buildPseudo(de.data);
  const pseudoFile = join(root, MESSAGE_DIR, 'en-XA.json');
  if (writePseudo) {
    writeJson(pseudoFile, pseudo);
    const text = readFileSync(pseudoFile, 'utf8');
    locales.set(PSEUDO_LOCALE, { file: pseudoFile, text, data: JSON.parse(text), ...flattenMessages(JSON.parse(text)) });
    out.wrote = pseudoFile;
    return;
  }
  const locale = locales.get(PSEUDO_LOCALE);
  if (!locale || !locale.flat) return;
  const { flat: expected } = flattenMessages(pseudo);
  for (const [key, entry] of expected) {
    const current = locale.flat.get(key);
    if (!current || current.value !== entry.value) {
      findings.push(new Finding(locale.file, root,
        current ? lineForKey(locale.text, current.path) : 1, 'pseudo-drift',
        `${key}: en-XA.json is not the deterministic pseudo-locale of de.json; run with --write-pseudo`));
    }
  }
}

function checkSharpS(root, locales, findings) {
  for (const [name, locale] of locales) {
    const lines = locale.text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(SHARP_S)) {
        findings.push(new Finding(locale.file, root, index + 1, 'sharp-s-in-messages',
          `${name}.json uses the German sharp-s character; write "ss"`));
      }
    }
  }
  const directory = join(root, I18N_DIR);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return;
  const files = [];
  walkFiles(directory, files, () => false);
  for (const file of files.sort()) {
    if (extname(file).toLowerCase() !== '.md') continue;
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(SHARP_S)) {
        findings.push(new Finding(file, root, index + 1, 'sharp-s-in-i18n-docs',
          'the i18n docs must use "ss", not the German sharp-s character'));
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* German in code                                                             */
/* -------------------------------------------------------------------------- */

function walkFiles(directory, files, skipDirectory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name) || skipDirectory(path)) continue;
      walkFiles(path, files, skipDirectory);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
}

function extractStrings(text, extension) {
  const strings = [];
  if (extension === '.html') {
    for (const match of text.matchAll(/\b[A-Za-z-]+\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const value = match[2] ?? match[3] ?? '';
      strings.push({ value, line: lineAt(text, match.index) });
    }
    for (const match of text.matchAll(/>([^<]+)</g)) {
      const value = match[1].trim();
      if (value) strings.push({ value, line: lineAt(text, match.index + 1) });
    }
    return strings;
  }
  if (extension === '.css') {
    for (const match of text.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
      strings.push({ value: match[1] ?? match[2] ?? '', line: lineAt(text, match.index) });
    }
    return strings;
  }
  for (const match of text.matchAll(/"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/gs)) {
    strings.push({ value: match[0].slice(1, -1), line: lineAt(text, match.index) });
  }
  return strings;
}

function checkGermanInCode(root, usedWords, findings) {
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absolute = join(root, scanRoot);
    if (!existsSync(absolute)) continue;
    walkFiles(absolute, files, (path) => toPosix(relative(root, path)).startsWith('tools/language-check/test'));
  }
  files.sort();
  for (const file of files) {
    const rel = toPosix(relative(root, file));
    if (SKIP_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
    if (rel.startsWith(`${MESSAGE_DIR}/`)) continue;
    const extension = extname(file).toLowerCase();
    if (!CODE_EXTENSIONS.has(extension)) continue;
    const text = readFileSync(file, 'utf8');
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === SHARP_S) {
        findings.push(new Finding(file, root, lineAt(text, index), 'sharp-s-in-code',
          'the German sharp-s character is not allowed in code; write "ss"'));
      }
    }
    for (const string of extractStrings(text, extension)) {
      const trimmed = string.value.trim();
      if (!trimmed) continue;
      if (UMLAUTS.test(trimmed)) {
        findings.push(new Finding(file, root, string.line, 'german-in-code',
          `umlaut in a user-facing string ${quote(trimmed)}`));
        continue;
      }
      const words = trimmed.match(/[A-Za-z]+/g) ?? [];
      const reported = new Set();
      for (const word of words) {
        const lower = word.toLowerCase();
        if (!usedWords.has(lower) || reported.has(lower)) continue;
        reported.add(lower);
        findings.push(new Finding(file, root, string.line, 'german-in-code',
          `German word "${word}" in a user-facing string ${quote(trimmed)}`));
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

function dedupe(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.rel}:${finding.line}:${finding.rule}:${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function report(findings, root) {
  const sorted = dedupe(findings).sort((left, right) => (
    left.rel.localeCompare(right.rel, 'en')
    || left.line - right.line
    || left.rule.localeCompare(right.rule, 'en')
    || left.message.localeCompare(right.message, 'en')
  ));
  for (const finding of sorted) {
    console.log(`${finding.rel}:${finding.line}: ${finding.rule}: ${finding.message}`);
  }
  if (sorted.length === 0) {
    console.log('language-check: OK');
    return 0;
  }
  console.error(`language-check: ${sorted.length} finding(s)`);
  return 1;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return 0;
  }
  if (options.error) usageError(options.error);

  const root = resolve(options.root);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    usageError(`root is not a directory: ${options.root}`);
  }

  const usedWords = readWordList();
  const locales = loadMessages(root, options.writePseudo);

  const findings = [];
  const out = {};
  const de = checkMessageCatalogue(root, locales, findings);
  checkSharpS(root, locales, findings);
  if (de) {
    checkKeyParity(root, locales, de, findings);
    checkIcu(root, locales, de, findings);
    checkPseudo(root, locales, de, options.writePseudo, findings, out);
  }
  checkGermanInCode(root, usedWords, findings);

  if (out.wrote) console.log(`language-check: wrote ${toPosix(relative(root, out.wrote))}`);
  return report(findings, root);
}

process.exit(main());
