import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkPlaywright(declared, locked, image) {
  if (!/^\d+\.\d+\.\d+$/.test(declared)) {
    throw new Error('Pin @playwright/test to an exact version so browser downloads are reproducible.');
  }
  if (locked !== declared) {
    throw new Error(`Playwright lockfile has ${locked}; package.json requires ${declared}. Run npm install.`);
  }
  if (image !== `mcr.microsoft.com/playwright:v${declared}-noble`) {
    throw new Error(`Playwright browser image must be mcr.microsoft.com/playwright:v${declared}-noble; found ${image}. Update compose.test.yaml with the npm dependency.`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('web/package.json', root), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('web/package-lock.json', root), 'utf8'));
  const compose = readFileSync(new URL('compose.test.yaml', root), 'utf8');
  const image = compose.match(/^\s*image:\s*(mcr\.microsoft\.com\/playwright:\S+)\s*$/m)?.[1];
  checkPlaywright(pkg.devDependencies['@playwright/test'], lock.packages['node_modules/@playwright/test']?.version, image);
  console.log('Playwright package, lockfile and browser image match.');
}
