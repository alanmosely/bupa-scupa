// Exercise the native startup/exit boundary, including nonzero CLI errors.
// Every process uses a synthetic, isolated archive and preferences directory.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

fs.mkdirSync('.cache/agent-startup', { recursive: true });
const root = fs.mkdtempSync(path.resolve('.cache/agent-startup/run-'));
const development = process.argv.includes('--development');
const exe = path.resolve(
  development ? 'node_modules/electron/dist/electron.exe' : 'dist/win-unpacked/BUPA SCUPA.exe',
);
async function launch(index) {
  const command = index % 2 ? 'not-a-command' : 'schema';
  const output = path.join(root, `response-${index}.json`);
  const child = spawn(
    exe,
    [
      ...(development ? ['.'] : []),
      '--agent',
      command,
      '--data-dir',
      path.join(root, `archive-${index}`),
      '--output',
      output,
    ],
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
  child.stdout.resume();
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Startup command timed out: ${command}`));
    }, 30000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  assert.equal(code, command === 'schema' ? 0 : 2, `Startup exit code: ${command}; ${stderr}`);
  const response = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(response.application, 'bupa-scupa');
  assert.equal(response.ok, command === 'schema');
  if (command !== 'schema') assert.equal(response.error.code, 'INVALID_INPUT');
}
for (let batch = 0; batch < 32; batch++) {
  const results = await Promise.allSettled(
    [0, 1, 2, 3].map((offset) => launch(batch * 4 + offset)),
  );
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
console.log(
  `Agent startup smoke passed: 128 concurrent schema/error commands retained valid responses and exit codes. ${development ? 'Development' : 'Packaged'} executable; synthetic archives only.`,
);
