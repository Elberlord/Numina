import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, SOURCE_FILES, readProjectFile, stripModuleSyntax } from './module-tools.mjs';

const dev = process.argv.includes('--dev');
const sync = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'scripts/sync-version.mjs')], { stdio: 'inherit' });
if (sync.status !== 0) process.exit(sync.status || 1);
const check = spawnSync(process.execPath, [path.join(PROJECT_ROOT, 'scripts/check-source.mjs')], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);

const vendor = await readProjectFile('vendor/firebase-runtime.js');
const pieces = [vendor.trimEnd()];
for (const file of SOURCE_FILES) {
  const source = stripModuleSyntax(await readProjectFile(file));
  pieces.push(`\n// ===== ${file} =====\n${source}`);
}
const output = `${pieces.join('\n')}\n`;
const tempRelative = dev ? 'app.bundle.dev.tmp.js' : 'app.bundle.tmp.js';
const finalRelative = dev ? 'app.bundle.dev.js' : 'app.bundle.js';
const tempPath = path.join(PROJECT_ROOT, tempRelative);
const finalPath = path.join(PROJECT_ROOT, finalRelative);
await fs.writeFile(tempPath, output, 'utf8');
const syntax = spawnSync(process.execPath, ['--check', tempPath], { encoding: 'utf8' });
if (syntax.status !== 0) {
  await fs.rm(tempPath, { force: true });
  throw new Error(`El bundle generado no es válido:\n${syntax.stderr || syntax.stdout}`);
}
await fs.rename(tempPath, finalPath);
console.log(`Build ${dev ? 'de desarrollo' : 'de producción'} generado: ${finalRelative}`);
