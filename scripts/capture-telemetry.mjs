// Read only the endpoints used by War Thunder's own localhost web page.
// This diagnostic captures evidence; it does not interpret events as battle results.
import { mkdir, open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const duration = Number(process.argv[2] ?? 900);
if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
  throw new Error('Duration must be between 1 and 3600 seconds.');
}

const endpoints = [
  'map_info.json', 'map_obj.json', 'mission.json',
  'hudmsg?lastEvt=0&lastDmg=0', 'gamechat?lastId=0', 'indicators', 'state',
];
const directory = fileURLToPath(new URL('../outputs/telemetry/', import.meta.url));
await mkdir(directory, { recursive: true });
const file = resolve(directory, `${new Date().toISOString().replaceAll(':', '-')}.jsonl`);
const log = await open(file, 'wx');
let stopping = false;
process.once('SIGINT', () => { stopping = true; });
process.once('SIGTERM', () => { stopping = true; });
const previous = new Map();
let cycles = 0;
const started = Date.now();

function summarize(endpoint, value) {
  if (endpoint === 'map_obj.json' && Array.isArray(value)) {
    const keys = [...new Set(value.flatMap((item) => Object.keys(item)))].sort();
    const types = {};
    for (const item of value) types[item.type] = (types[item.type] ?? 0) + 1;
    return { keys, types, player: value.find((item) => item.icon?.toLowerCase() === 'player') ?? null };
  }
  if (endpoint === 'state' || endpoint === 'indicators') {
    // Keep the schema and vehicle identity, not a high-volume cockpit recording.
    return { keys: Object.keys(value).sort(), valid: value.valid, army: value.army, type: value.type };
  }
  return value;
}

console.log(`Read-only telemetry capture started for up to ${duration}s.\nLocal output: ${file}`);
try {
  await log.write(`${JSON.stringify({ capturedAt: new Date().toISOString(), kind: 'capture-start', durationSeconds: duration, endpoints })}\n`);
  while (!stopping && Date.now() - started < duration * 1000) {
    const cycleStart = Date.now();
    const results = await Promise.all(endpoints.map(async (endpoint) => {
      try {
        const response = await fetch(`http://127.0.0.1:8111/${endpoint}`, {
          signal: AbortSignal.timeout(4000), redirect: 'error', cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return { endpoint, data: summarize(endpoint, await response.json()) };
      } catch (error) {
        return { endpoint, error: error.message };
      }
    }));
    const capturedAt = new Date().toISOString();
    for (const result of results) {
      const fingerprint = JSON.stringify(result);
      if (previous.get(result.endpoint) === fingerprint) continue;
      previous.set(result.endpoint, fingerprint);
      await log.write(`${JSON.stringify({ capturedAt, ...result })}\n`);
      if (result.endpoint === 'map_obj.json') continue;
      if (result.endpoint.startsWith('hudmsg') && result.data) {
        console.log(`${capturedAt} HUD: ${result.data.events?.length ?? 0} events, ${result.data.damage?.length ?? 0} damage messages`);
      } else if (result.endpoint.startsWith('gamechat') && result.data) {
        console.log(`${capturedAt} Chat: ${result.data.length} records`);
      } else {
        console.log(`${capturedAt} ${result.endpoint}: ${result.error ?? JSON.stringify(result.data)}`);
      }
    }
    cycles++;
    await delay(Math.max(0, 1000 - (Date.now() - cycleStart)));
  }
} finally {
  await log.write(`${JSON.stringify({ capturedAt: new Date().toISOString(), kind: 'capture-end', cycles })}\n`);
  await log.close();
  console.log(`Capture finished (${cycles} samples per endpoint). ${file}`);
}
