// Optional build-time maintenance. Prints a patch; no game access or runtime network lookup.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { englishEntries, revision } from './aircraft-catalog.mjs';

const repository = 'https://github.com/gszabi99/War-Thunder-Datamine';
const sourceFile = 'lang.vromfs.bin_u/lang/missions_locations.csv';

export function compileMaps(names) {
  return Object.fromEntries([...names].flatMap(([key, text]) => {
    const match = /^location\/([a-z0-9_]+)$/.exec(key);
    const name = text.replace(/[\u2012-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
    return match && name && !/[<>]|\{\{/.test(name) ? [[match[1], name]] : [];
  }).sort(([a], [b]) => a.localeCompare(b)));
}

async function generate() {
  const ref = process.argv[2] || revision;
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('Provide an immutable game-data commit SHA');
  const response = await fetch(`https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/${ref}/${sourceFile}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Map localization: HTTP ${response.status}`);
  const maps = compileMaps(englishEntries(await response.text()));
  if (Object.keys(maps).length < 100) throw new Error('Incomplete map catalog');
  const content = JSON.stringify({ source: { repository, revision: ref, file: sourceFile }, maps }, null, 2) + '\n';
  const target = new URL('../app/lib/map-catalog.json', import.meta.url);
  let previous = null;
  try { previous = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous === content) return;
  const next = content.trimEnd().split('\n');
  let body;
  if (previous === null) body = next.map(line => `+${line}`).join('\n');
  else {
    const old = previous.trimEnd().split('\n');
    let start = 0, end = 0;
    while (start < Math.min(old.length, next.length) && old[start] === next[start]) start++;
    while (end < Math.min(old.length, next.length) - start && old[old.length - 1 - end] === next[next.length - 1 - end]) end++;
    body = ['@@', ...old.slice(Math.max(0, start - 3), start).map(line => ` ${line}`),
      ...old.slice(start, old.length - end).map(line => `-${line}`),
      ...next.slice(start, next.length - end).map(line => `+${line}`),
      ...old.slice(old.length - end, Math.min(old.length, old.length - end + 3)).map(line => ` ${line}`)].join('\n');
  }
  process.stdout.write(`*** Begin Patch\n*** ${previous === null ? 'Add' : 'Update'} File: ${fileURLToPath(target).replaceAll('\\', '/')}\n${body}\n*** End Patch\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generate();
