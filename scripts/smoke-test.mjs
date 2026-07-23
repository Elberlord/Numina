import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from './module-tools.mjs';

const pages = ['portal.html', 'panel-privado-8f27c4.html'];
const pageSources = await Promise.all(pages.map(file => fs.readFile(path.join(PROJECT_ROOT, file), 'utf8')));
const bundle = await fs.readFile(path.join(PROJECT_ROOT, 'app.bundle.js'), 'utf8');

for (const [index, source] of pageSources.entries()) {
  const file = pages[index];
  if (!/<body\b/i.test(source)) throw new Error(`${file} no contiene body.`);
  if (!source.includes('app.bundle.js')) throw new Error(`${file} no carga app.bundle.js.`);
  if (!source.includes('stability.js')) throw new Error(`${file} no carga stability.js.`);
  if (!/id=["']bootView["']/.test(source)) throw new Error(`${file} no contiene bootView.`);
  if (!/id=["']accessView["']/.test(source)) throw new Error(`${file} no contiene accessView.`);
  if (!/id=["']appView["']/.test(source)) throw new Error(`${file} no contiene appView.`);
}

const ids = new Set(pageSources.flatMap(source => [...source.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1])));
const selectors = new Set([...bundle.matchAll(/\$\(['"]#([A-Za-z0-9_-]+)['"]\)/g)].map(match => match[1]));
const optionalIds = new Set(['installAccessBtn', 'installBackupBtn', 'retryAccessBtn', 'blockedSignOutBtn', 'whatsappRequestBtn', 'enterPendingKeyBtn', 'pendingSignOutBtn']);
const missing = [...selectors].filter(id => !ids.has(id) && !optionalIds.has(id));
if (missing.length) throw new Error(`Faltan elementos DOM requeridos: ${missing.join(', ')}`);

if (!bundle.includes("onAuthStateChanged(auth")) throw new Error('El bundle no contiene el arranque de autenticación.');
if (!bundle.includes("navigator.serviceWorker.register('./sw.js')")) throw new Error('El bundle no registra el service worker.');
if (!bundle.includes('updateConnectionUi();\napplyPrivacyMode();\nrefreshInstallButtons();')) throw new Error('El bloque final de inicialización está incompleto.');

console.log(`OK: smoke test estático completado (${selectors.size} selectores DOM comprobados).`);
