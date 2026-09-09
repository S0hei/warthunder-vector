import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDirectory = resolve(projectRoot, '.portable-build');
const outputPath = resolve(projectRoot, 'Vector.html');

function resolveAsset(reference) {
  const relativePath = reference.replace(/^\.\//, '').replace(/^\//, '');
  const resolved = resolve(buildDirectory, relativePath);
  if (!resolved.startsWith(`${buildDirectory}\\`) && resolved !== buildDirectory) {
    throw new Error(`Portable build referenced an unexpected path: ${reference}`);
  }
  return resolved;
}

let html = await readFile(resolve(buildDirectory, 'index.html'), 'utf8');

// A data URI keeps the tab icon working from file:// and the single-file EXE,
// without adding a second asset or a new route to the local server.
const icon = (await readFile(resolve(projectRoot, 'public/favicon.svg'))).toString('base64');
html = html.replace('</head>', `  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${icon}" />\n</head>`);

for (const match of [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/gi)]) {
  const css = (await readFile(resolveAsset(match[1]), 'utf8')).replace(/<\/style/gi, '<\\/style');
  html = html.replace(match[0], () => `<style>${css}</style>`);
}

for (const match of [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/gi)]) {
  const javascript = (await readFile(resolveAsset(match[1]), 'utf8')).replace(/<\/script/gi, '<\\/script');
  html = html.replace(match[0], () => `<script type="module">${javascript}</script>`);
}

const unresolvedReference =
  html.match(/<script\b[^>]*\bsrc=/i) ??
  html.match(/<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*\bhref=/i) ??
  html.match(/(?:\.\/|\/)assets\//i) ??
  html.match(/main\.tsx/i);

if (unresolvedReference) {
  throw new Error(`Portable output still contains an external build reference: ${unresolvedReference[0].slice(0, 180)}`);
}

if (!html.includes('<script type="module">') || !html.includes('<style>')) {
  throw new Error('Portable output is missing its inlined script or stylesheet.');
}

html = html.replace('<!doctype html>', '<!doctype html>\n<!-- Standalone Vector map. Run Vector.exe for automatic battle history and Activity team annotations. -->');
const aircraftNotices = await readFile(resolve(projectRoot, 'public/aircraft-notices.txt'), 'utf8');
html = html.replace('</head>', `<!--\n${aircraftNotices.replaceAll('--', '—')}\n-->\n</head>`);
const fontNotices = await readFile(resolve(projectRoot, 'public/font-notices.txt'), 'utf8');
html = html.replace('</head>', `<!--\n${fontNotices.replaceAll('--', '—')}\n-->\n</head>`);
await writeFile(outputPath, html, 'utf8');
await rm(buildDirectory, { recursive: true, force: true });

const sizeKb = Math.ceil(Buffer.byteLength(html) / 1024);
process.stdout.write(`Portable Vector created: ${outputPath} (${sizeKb} KB)\n`);
