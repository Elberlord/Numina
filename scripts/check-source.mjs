import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, SOURCE_FILES, readProjectFile, parseRelativeImports, parseNamedExports, resolveImport } from './module-tools.mjs';

const sources = new Map();
for (const file of SOURCE_FILES) {
  const fullPath = path.join(PROJECT_ROOT, file);
  await fs.access(fullPath);
  const check = spawnSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`Error de sintaxis en ${file}:\n${check.stderr || check.stdout}`);
  sources.set(file, await readProjectFile(file));
}

const exportsByFile = new Map([...sources].map(([file, source]) => [file, parseNamedExports(source)]));
const graph = new Map();
for (const [file, source] of sources) {
  const dependencies = [];
  for (const entry of parseRelativeImports(source)) {
    const target = resolveImport(file, entry.specifier);
    if (!sources.has(target)) throw new Error(`${file}: el import ${entry.specifier} no apunta a un módulo conocido.`);
    dependencies.push(target);
    const available = exportsByFile.get(target);
    for (const name of entry.names) {
      if (!available.has(name)) throw new Error(`${file}: “${name}” no está exportado por ${target}.`);
    }
  }
  graph.set(file, dependencies);
}

const visiting = new Set();
const visited = new Set();
function visit(file, stack = []) {
  if (visiting.has(file)) throw new Error(`Dependencia circular: ${[...stack, file].join(' -> ')}`);
  if (visited.has(file)) return;
  visiting.add(file);
  for (const dependency of graph.get(file) || []) visit(dependency, [...stack, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of SOURCE_FILES) visit(file);

console.log(`OK: ${SOURCE_FILES.length} módulos válidos, imports verificados y sin ciclos.`);
