// Build-time maintenance only. Prints a patch with reviewed in-game UI assets.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { compactFlag, revision } from './aircraft-catalog.mjs';

export const iconFiles = {
  silverLions: 'wp_coin.png', experience: 'lb_online_exp_gained_for_common.svg',
  victories: 'lb_victories_battles.svg', killDeath: 'lb_average_active_kills.svg',
  killSpawn: 'lb_average_active_kills_by_spawn.svg', kills: 'lb_air_ground_kills.svg',
  deaths: 'lb_deaths.svg', spawns: 'lb_flyouts.svg', airKills: 'lb_air_kills.svg',
  activity: 'lb_activity.svg', participants: 'lb_members_cnt.svg', target: 'lb_target_hits.svg',
  results: 'sh_statistics.svg',
};

export function iconAsset(file, bytes) {
  if (bytes.length > 65536) throw new Error('Oversized game icon');
  if (file.endsWith('.png')) {
    if (bytes.length < 33 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('Invalid PNG icon');
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    if (!width || !height || width > 512 || height > 512) throw new Error('Unexpected icon dimensions');
    return { mode: 'image', src: `data:image/png;base64,${bytes.toString('base64')}` };
  }
  if (!file.endsWith('.svg')) throw new Error('Unsupported icon format');
  const source = bytes.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY|@import|<\s*(?:a|use|animate\w*|set)\b|url\(/i.test(source)) throw new Error('Unexpected active or referenced icon content');
  return { mode: 'mask', src: compactFlag(source) };
}

async function generate() {
  const ref = process.argv[2] || revision;
  if (!/^[0-9a-f]{40}$/.test(ref)) throw new Error('Provide an immutable game-data commit SHA');
  const directory = 'atlases.vromfs.bin_u/gameuiskin';
  const icons = {};
  for (const [name, file] of Object.entries(iconFiles)) {
    const response = await fetch(`https://raw.githubusercontent.com/gszabi99/War-Thunder-Datamine/${ref}/${directory}/${file}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    icons[name] = { file, sha256: createHash('sha256').update(bytes).digest('hex'), ...iconAsset(file, bytes) };
  }
  const content = JSON.stringify({ source: { repository: 'https://github.com/gszabi99/War-Thunder-Datamine', revision: ref, directory }, icons }, null, 2) + '\n';
  const target = new URL('../app/lib/game-icons.json', import.meta.url);
  let previous = null;
  try { previous = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous === content) return;
  const path = fileURLToPath(target).replaceAll('\\', '/');
  const next = content.trimEnd().split('\n');
  const body = previous === null ? next.map(line => `+${line}`).join('\n')
    : ['@@', ...previous.trimEnd().split('\n').map(line => `-${line}`), ...next.map(line => `+${line}`)].join('\n');
  process.stdout.write(`*** Begin Patch\n*** ${previous === null ? 'Add' : 'Update'} File: ${path}\n${body}\n*** End Patch\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generate();
