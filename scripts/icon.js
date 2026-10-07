// Render the shared Clean Sweep vector into every Windows icon size.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchInstalledBrowser } from '../src/core/browser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browser = await launchInstalledBrowser({ headless: true });
try {
  const page = await browser.newPage();
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  await page.goto(pathToFileURL(path.join(root, 'src/ui/clean-sweep.svg')).href);
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    images.push(await page.screenshot({ omitBackground: true }));
  }
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size % 256;
    header[entry + 1] = size % 256;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, ...images]));
  console.log('Clean Sweep Windows icon generated at ' + sizes.join(', ') + 'px.');
} finally {
  await browser.close();
}
