// Node-only component/logic checks. No browser, DOM, game control or network.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

export function componentLoader(overrides = {}) {
  const cache = new Map(), require = createRequire(import.meta.url);
  function load(file) {
    const path = fileURLToPath(new URL(`../app/${file}`, import.meta.url));
    return moduleAt(path);
  }
  function moduleAt(path) {
    if (cache.has(path)) return cache.get(path);
    if (path.endsWith('.json')) return JSON.parse(readFileSync(path, 'utf8'));
    const exports = {};
    cache.set(path, exports);
    const source = readFileSync(path, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } });
    runInNewContext(outputText, { exports, require: id => {
      if (id in overrides) return overrides[id];
      if (!id.startsWith('.')) return require(id);
      const base = resolve(dirname(path), id);
      const local = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`].find(existsSync);
      if (!local) throw Error(`Unresolved test import: ${id}`);
      return moduleAt(local);
    } });
    return exports;
  }
  return load;
}
