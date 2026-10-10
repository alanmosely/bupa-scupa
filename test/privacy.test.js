import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkPublicPath, checkTrackedFiles } from '../scripts/check.js';

fs.mkdirSync('.cache/tests', { recursive: true });
function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
}
function repository() {
  const root = fs.mkdtempSync(path.resolve('.cache/tests/privacy-'));
  git(root, ['init', '--quiet']);
  return root;
}
test('public path policy rejects archive material and unknown roots', () => {
  for (const file of [
    'household.json',
    'workspace.json',
    'src/workspace.json',
    'raw/statement.pdf',
    'master/claims.csv',
    'docs/capture.pdf',
    'docs/images/portal.png',
    'docs/images/dashboard.jpg',
    'src/household.json',
    'misc/secret.txt',
  ])
    assert.throws(() => checkPublicPath(file));
  checkPublicPath('docs/RELEASE.md');
  checkPublicPath('docs/images/dashboard.png');
  checkPublicPath('src/core/parse.js');
});
test('a tracked file outside packaging roots cannot pass publication checks', () => {
  const root = repository();
  fs.writeFileSync(path.join(root, 'unexpected.txt'), 'synthetic');
  git(root, ['add', 'unexpected.txt']);
  assert.throws(() => checkTrackedFiles(root), /outside the reviewed public allowlist/);
});
test('unsafe staged content cannot be hidden by a safe working copy', () => {
  const root = repository();
  const file = path.join(root, 'README.md');
  fs.writeFileSync(file, '-----BEGIN ' + 'PRIVATE KEY-----');
  git(root, ['add', 'README.md']);
  fs.writeFileSync(file, 'Safe example.');
  assert.throws(() => checkTrackedFiles(root), /Private key found/);
});
test('working copy content is inspected as well as the safe staged blob', () => {
  const root = repository();
  const file = path.join(root, 'README.md');
  fs.writeFileSync(file, 'Safe example.');
  git(root, ['add', 'README.md']);
  fs.writeFileSync(file, '-----BEGIN ' + 'PRIVATE KEY-----');
  assert.throws(() => checkTrackedFiles(root), /Private key found/);
});
