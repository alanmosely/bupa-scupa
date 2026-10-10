import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const roots = ['src', 'scripts', 'test', 'docs', '.github', 'assets'];
export const top = [
  'package.json',
  'package-lock.json',
  'vendor-lock.json',
  'README.md',
  'LICENSE',
  'NOTICE',
  'PRIVACY.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'AGENTS.md',
  'AGENT_API.md',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  'eslint.config.js',
  'tsconfig.json',
  '.prettierrc.json',
  '.prettierignore',
];
export function files(root = process.cwd()) {
  const result = top.filter((f) => fs.existsSync(path.join(root, f)));
  const walk = (p) => {
    for (const entry of fs.readdirSync(path.join(root, p), { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('Do not package symbolic links: ' + path.join(p, entry.name));
      const name = path.join(p, entry.name);
      if (entry.isDirectory()) walk(name);
      else result.push(name);
    }
  };
  for (const directory of roots) if (fs.existsSync(path.join(root, directory))) walk(directory);
  return result;
}
export function checkPublicPath(file) {
  const normal = file.replaceAll('\\', '/');
  if (
    normal
      .split('/')
      .some((part) =>
        [
          'data',
          'private',
          'raw',
          'master',
          'reports',
          'discover',
          'captures',
          'household-backups',
        ].includes(part.toLowerCase()),
      ) ||
    /(?:^|\/)(?:household|parsed)\.json$/i.test(normal) ||
    /\.(?:pdf|csv|bak|log|tmp)$/i.test(normal)
  )
    throw new Error('Private archive material found: ' + file);
  if (
    !top.includes(normal) &&
    normal !== 'docs/images/dashboard.png' &&
    (!roots.includes(normal.split('/')[0]) ||
      !/\.(?:js|cjs|d\.ts|md|json|yml|yaml|html|css|svg|ico|ps1)$/.test(normal))
  ) {
    throw new Error('File outside the reviewed public allowlist: ' + file);
  }
}
export function checkContent(file, content) {
  if (/[A-Z]:[\\/]Users[\\/](?!Example\b)/i.test(content))
    throw new Error('Personal machine path found: ' + file);
  for (const ref of content.match(/CL\d{12}/g) || [])
    if (!ref.startsWith('CL000101'))
      throw new Error('Non-synthetic claim reference found: ' + file);
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content))
    throw new Error('Private key found: ' + file);
  if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(content))
    throw new Error('Possible credential found: ' + file);
}
export function checkTrackedFiles(root = process.cwd()) {
  // Source ZIPs have no Git metadata. Do not accidentally inspect a parent repo.
  if (!fs.existsSync(path.join(root, '.git'))) return 0;
  const inventory = spawnSync('git', ['ls-files', '--stage', '-z'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (inventory.status !== 0) throw new Error('Could not inspect tracked files.');
  const entries = inventory.stdout.split('\0').filter(Boolean);
  for (const entry of entries) {
    const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
    if (!match || match[3] !== '0') throw new Error('Resolve the Git index before publishing.');
    const [, mode, hash, , file] = match;
    checkPublicPath(file);
    if (mode !== '100644' && mode !== '100755')
      throw new Error('Do not publish tracked symlinks or submodules: ' + file);
    // Inspect the staged blob too: a safe working copy can hide unsafe staged content.
    const blob = spawnSync('git', ['cat-file', 'blob', hash], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (blob.status !== 0) throw new Error('Could not inspect staged file: ' + file);
    checkContent(file, blob.stdout);
    const working = path.join(root, file);
    if (fs.existsSync(working)) {
      if (fs.lstatSync(working).isSymbolicLink())
        throw new Error('Do not publish symbolic links: ' + file);
      checkContent(file, fs.readFileSync(working, 'utf8'));
    }
  }
  return entries.length;
}
export function checkProject(root = process.cwd()) {
  const publicFiles = files(root);
  for (const file of publicFiles) {
    checkPublicPath(file);
    checkContent(file, fs.readFileSync(path.join(root, file), 'utf8'));
    if (/\.c?js$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {
        encoding: 'utf8',
        windowsHide: true,
      });
      if (result.status !== 0) throw new Error(file + ': ' + result.stderr);
    }
  }
  const tracked = checkTrackedFiles(root);
  for (const required of top)
    if (!fs.existsSync(path.join(root, required)))
      throw new Error('Missing public project file: ' + required);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.build.portable?.unpackDirName !== true)
    throw new Error('Portable launches must use separate per-process extraction folders.');
  if (pkg.build.portable?.artifactName !== 'bupa-scupa-x64.exe')
    throw new Error('Build one portable EXE with the permanent download filename.');
  if (pkg.build.files.some((f) => /data|private|\.cache|\*\*\/\*/.test(f) && f !== 'src/**/*'))
    throw new Error('Review the desktop packaging allowlist.');
  console.log(
    `Checked syntax and public source hygiene in ${publicFiles.length} files and ${tracked} tracked files (index and working copy). Release packaging uses an explicit allowlist. Review names and screenshots manually before publishing.`,
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  checkProject();
