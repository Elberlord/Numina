import fs from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const SOURCE_FILES = [
  'src/modules/context.js',
  'src/modules/core.js',
  'src/modules/domain.js',
  'src/modules/data.js',
  'src/modules/ui.js',
  'src/modules/admin.js',
  'src/app-src.js'
];

export async function readProjectFile(relativePath) {
  return fs.readFile(path.join(PROJECT_ROOT, relativePath), 'utf8');
}

export async function writeProjectFile(relativePath, contents) {
  const target = path.join(PROJECT_ROOT, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, 'utf8');
}

export function stripModuleSyntax(source) {
  const lines = source.split(/\r?\n/);
  const output = [];
  let skipping = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!skipping && trimmed.startsWith('import ')) {
      skipping = !line.includes(';');
      continue;
    }
    if (skipping) {
      if (line.includes(';')) skipping = false;
      continue;
    }
    if (trimmed.startsWith('export {')) {
      skipping = !line.includes('};');
      continue;
    }
    output.push(line);
  }
  if (skipping) throw new Error('Se encontró un bloque import/export sin cerrar.');
  return output.join('\n').trim();
}

export function parseRelativeImports(source) {
  const imports = [];
  const pattern = /import\s*\{([^;]*?)\}\s*from\s*['"](\.[^'"]+)['"]\s*;/g;
  for (const match of source.matchAll(pattern)) {
    const names = match[1].split(',').map(item => item.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    imports.push({ specifier: match[2], names });
  }
  return imports;
}

export function parseNamedExports(source) {
  const exports = new Set();
  const pattern = /export\s*\{([^;]*?)\}\s*;/g;
  for (const match of source.matchAll(pattern)) {
    for (const part of match[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).at(-1);
      if (name) exports.add(name);
    }
  }
  return exports;
}

export function resolveImport(fromRelativePath, specifier) {
  const base = path.posix.dirname(fromRelativePath);
  return path.posix.normalize(path.posix.join(base, specifier));
}
