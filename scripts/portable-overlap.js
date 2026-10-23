// Regression: concurrent portable invocations must not share or remove their runtime.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

fs.mkdirSync('.cache/portable-overlap', { recursive: true });
const root = fs.mkdtempSync(path.resolve('.cache/portable-overlap/run-'));
const exe = path.resolve('dist/bupa-scupa-x64.exe');
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
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  child.stdout.on('data', (chunk) => {
    stdout = (stdout + chunk.toString()).slice(-4000);
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
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
        reject(
          new Error(
            'Concurrent portable command failed: ' +
              command +
              ' (' +
              code +
              ')\n' +
              stderr +
              '\nAgent output: ' +
              (fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : stdout || '(none)'),
          ),
        );
      else resolve();
    });
  });
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.command, command);
}
// Every pair must pass. Use fresh output/archive paths for each pair so an
// earlier result cannot hide a missing response from a later invocation.
for (let round = 0; round < 3; round++) {
  const results = await Promise.allSettled([
    launch('schema', round * 2 + 1),
    launch('status', round * 2 + 2),
  ]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
console.log(
  'Three consecutive pairs of concurrent portable agent invocations passed with isolated empty archives and system-only PATH. No login or real records.',
);
