import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const CLI = fileURLToPath(new URL('../index.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function fixture(name) {
  return join(FIXTURES, name);
}

function output(result) {
  return `${result.stdout}\n${result.stderr}`;
}

test('clean fixture passes with exit 0 and no findings', () => {
  const result = run([fixture('clean')]);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /language-check: OK/);
  assert.equal(result.stderr, '');
});

test('key drift is reported per key with file, line and rule', () => {
  const result = run([fixture('key-drift')]);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout,
    /apps\/web\/messages\/en\.json:\d+: key-parity: key "note\.untitled" is missing in en\.json but present in de\.json/);
});

test('broken ICU is reported with the message key', () => {
  const result = run([fixture('broken-icu')]);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout,
    /apps\/web\/messages\/de\.json:\d+: icu-syntax: canvas\.selection\.count: unclosed opening brace/);
});

test('the German sharp-s character in code is reported', () => {
  const result = run([fixture('sharp-s-in-code')]);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout,
    /apps\/web\/components\/example\.ts:1: sharp-s-in-code: the German sharp-s character is not allowed in code/);
});

test('a German word in a user-facing string is reported', () => {
  const result = run([fixture('german-word')]);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout,
    /apps\/web\/components\/example\.ts:1: german-in-code: German word "Bitte" in a user-facing string/);
});

test('a drifting pseudo-locale is reported per key', () => {
  const result = run([fixture('pseudo-drift')]);
  assert.equal(result.status, 1, output(result));
  assert.match(result.stdout,
    /apps\/web\/messages\/en-XA\.json:\d+: pseudo-drift: panel\.close: en-XA\.json is not the deterministic pseudo-locale/);
});

test('--write-pseudo repairs en-XA.json and is deterministic on a second run', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'language-check-'));
  const project = join(temporary, 'project');
  try {
    cpSync(fixture('pseudo-drift'), project, { recursive: true });

    const write = run([project, '--write-pseudo']);
    assert.equal(write.status, 0, output(write));
    assert.match(write.stdout, /wrote apps\/web\/messages\/en-XA\.json/);

    const written = readFileSync(join(project, 'apps/web/messages/en-XA.json'), 'utf8');
    const second = run([project, '--write-pseudo']);
    assert.equal(second.status, 0, output(second));
    assert.equal(readFileSync(join(project, 'apps/web/messages/en-XA.json'), 'utf8'), written);

    const check = run([project]);
    assert.equal(check.status, 0, output(check));
    assert.match(check.stdout, /language-check: OK/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('a missing root is a configuration error with exit 2', () => {
  const result = run([join(tmpdir(), 'language-check-does-not-exist')]);
  assert.equal(result.status, 2, output(result));
  assert.match(result.stderr, /root is not a directory/);
});

test('the repository itself passes', () => {
  const result = run([REPO_ROOT]);
  assert.equal(result.status, 0, output(result));
  assert.match(result.stdout, /language-check: OK/);
});
