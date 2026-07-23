import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './module-tools.mjs';

const packageJson = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const version = packageJson.version;
const cacheVersion = version.replace(/\./g, '-');
const appVersion = `firebase-completa-v${version}-series`;

async function replaceIn(relativePath, pattern, replacement) {
  const file = path.join(PROJECT_ROOT, relativePath);
  const source = await fs.readFile(file, 'utf8');
  if (!pattern.test(source)) throw new Error(`No se encontró el marcador de versión en ${relativePath}.`);
  await fs.writeFile(file, source.replace(pattern, replacement), 'utf8');
}

await fs.writeFile(path.join(PROJECT_ROOT, 'VERSION.txt'), `${version}\n`, 'utf8');
await replaceIn('src/modules/context.js', /const APP_VERSION = '[^']+';/, `const APP_VERSION = '${appVersion}';`);
await replaceIn('src/stability-src.js', /const STABILITY_VERSION = '[^']+';/, `const STABILITY_VERSION = '${version}';`);
await replaceIn('stability.js', /const STABILITY_VERSION = '[^']+';/, `const STABILITY_VERSION = '${version}';`);
await replaceIn('sw.js', /const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'numina-serie-v${cacheVersion}';`);

console.log(`Versiones sincronizadas: ${version}`);
