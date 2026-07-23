import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT } from './module-tools.mjs';

const required = ['index.html', 'portal.html', 'panel-privado-8f27c4.html', 'app.bundle.js', 'stability.js', 'sw.js', 'manifest.webmanifest', 'VERSION.txt'];
for (const file of required) await fs.access(path.join(PROJECT_ROOT, file));
const version = (await fs.readFile(path.join(PROJECT_ROOT, 'VERSION.txt'), 'utf8')).trim();
const bundle = await fs.readFile(path.join(PROJECT_ROOT, 'app.bundle.js'), 'utf8');
if (!bundle.includes(`firebase-completa-v${version}-series`)) throw new Error('app.bundle.js no contiene la versión esperada.');
if (/^\s*(import|export)\s/m.test(bundle)) throw new Error('app.bundle.js todavía contiene sintaxis de módulos.');
for (const html of ['portal.html', 'panel-privado-8f27c4.html']) {
  const source = await fs.readFile(path.join(PROJECT_ROOT, html), 'utf8');
  if (!source.includes('app.bundle.js')) throw new Error(`${html} no carga app.bundle.js.`);
}
const syntax = spawnSync(process.execPath, ['--check', path.join(PROJECT_ROOT, 'app.bundle.js')], { encoding: 'utf8' });
if (syntax.status !== 0) throw new Error(syntax.stderr || syntax.stdout);
console.log(`OK: distribución v${version} verificada.`);
