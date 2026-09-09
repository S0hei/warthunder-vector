// Build-time only. Reads public, extracted game resources; never accesses game memory.
// Prints an apply_patch patch for review. No downloads or lookups at application runtime.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const revision = '412aab2a8773298d6cf9b872af94b30cf0d23eef';
const repository = 'https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine';

// Game localization is semicolon-delimited CSV with escaped quotes and multiline cells.
export function englishEntries(csv) {
  const entries = new Map();
  let row = [], field = '', quoted = false;
  for (let i = 0; i <= csv.length; i++) {
    const char = csv[i] ?? '\n';
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ';' || char === '\n')) {
      row.push(field.replace(/\r$/, '')); field = '';
      if (char === '\n') { if (row[0] && row[1]) entries.set(row[0], row[1]); row = []; }
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed localization field');
  return entries;
}

export function displayName(value) {
  // The game font's nation glyph is replaced by an actual flag, not a missing-glyph square.
  return value.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim();
}

export function compileAircraft(tags, names) {
  return Object.fromEntries(Object.entries(tags).sort(([a], [b]) => a.localeCompare(b)).flatMap(([id, unit]) => {
    if (!['aircraft', 'helicopter'].includes(unit.type)) return [];
    const name = names.get(`${id}_0`) || names.get(`${id}_shop`);
    if (!name || !displayName(name)) return [];
    const tagCountries = Object.entries(unit.tags ?? {}).filter(([key, value]) => key.startsWith('country_') && value === true).map(([key]) => key);
    const operators = unit.operatorCountry ? [unit.operatorCountry].flat() : tagCountries.length === 1 ? tagCountries : [];
    const countries = [...new Set(operators.filter(country => typeof country === 'string' && country !== 'country_invisible'))];
    return [[id, [displayName(name), countries]]];
  }));
}

export function compactFlag(svg) {
  const clean = svg.replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '').replace(/<\?xml[^?]*\?>/g, '').trim();
  if (!clean.startsWith('<svg') || /<(?:script|foreignObject|iframe|image)\b|\bon\w+\s*=|(?:href\s*=\s*["'](?!#))|url\(\s*["']?(?!#)[a-z]/i.test(clean)) throw new Error('Unexpected flag asset');
  return `data:image/svg+xml;base64,${Buffer.from(clean).toString('base64')}`;
}

async function generate() {
  const ref = process.argv[2] || revision;
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('Provide an immutable game-data commit SHA');
  const get = async path => {
    const response = await fetch(`${repository}/${ref}/${path}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.text();
  };
  const [tags, names, countryNames] = await Promise.all([
    get('char.vromfs.bin_u/config/unittags.blkx').then(JSON.parse),
    get('lang.vromfs.bin_u/lang/units.csv').then(englishEntries),
    readFile(new URL('./aircraft-countries.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);
  const aircraft = compileAircraft(tags, names);
  if (Object.keys(aircraft).length < 1000) throw new Error('Incomplete aircraft catalog');
  const countries = {};
  // Bounded concurrency keeps this optional maintenance step polite to the source host.
  const queue = [...new Set(Object.values(aircraft).flatMap(([, countries]) => countries))].sort();
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const country = queue.shift();
      if (!countryNames[country]) throw new Error(`Add a reviewed country label for ${country}`);
      // This flag is absent from the extracted game's SVG atlas.
      const svg = country === 'country_republic_china'
        ? await fetch('https://raw.githubusercontent.com/lipis/flag-icons/v7.5.0/flags/4x3/tw.svg', { signal: AbortSignal.timeout(30000) }).then(async response => {
          if (!response.ok) throw new Error(`ROC flag: HTTP ${response.status}`);
          return response.text();
        }) : await get(`atlases.vromfs.bin_u/gameuiskin/${country}.svg`);
      const flag = compactFlag(svg);
      countries[country] = [countryNames[country], flag];
    }
  }));
  const data = { source: { repository: 'https://github.com/gszabi99/War-Thunder-Datamine', revision: ref }, aircraft,
    countries: Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b))) };
  const target = new URL('../app/lib/aircraft-catalog.json', import.meta.url);
  const content = JSON.stringify(data, null, 2) + '\n';
  let previous = null;
  try { previous = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous === content) return;
  const path = fileURLToPath(target).replaceAll('\\', '/');
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
  process.stdout.write(`*** Begin Patch\n*** ${previous === null ? 'Add' : 'Update'} File: ${path}\n${body}\n*** End Patch\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generate();
