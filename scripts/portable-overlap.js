// Regression: concurrent portable invocations must not share or remove their runtime.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { VERSION } from '../src/version.js';

fs.mkdirSync('.cache/portable-overlap', { recursive: true });
const root = fs.mkdtempSync(path.resolve('.cache/portable-overlap/run-'));
const exe = path.resolve(`dist/bupa-scupa-${VERSION}-x64.exe`);
async function launch(command, index) {
  const output = path.join(root, `response-${index}.json`);
  const child = spawn(
    exe,
    ['--agent', command, '--data-dir', path.join(root, `archive-${index}`), '--output', output],
    {
      env: {
        ...process.env,
        PATH: path.join(process.env.SystemRoot, 'System32'),
        SCUPA_APP_DIR: path.join(root, `preferences-${index}`),
      },
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Concurrent portable command timed out: ' + command));
    }, 120000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(new Error('Concurrent portable command failed: ' + command + ' (' + code + ')'));
      else resolve();
    });
  });
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.command, command);
}
// Start both immediately; wait for both even if one fails so no test is abandoned.
const results = await Promise.allSettled([launch('schema', 1), launch('status', 2)]);
for (const result of results) if (result.status === 'rejected') throw result.reason;
console.log(
  'Concurrent portable agent invocations passed with isolated empty archives and system-only PATH. No login or real records.',
);
