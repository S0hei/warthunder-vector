import { readFile } from 'node:fs/promises';
import { collectCombatEvents } from './lib/combat-events.mjs';

if (!process.argv[2]) throw new Error('Provide the path to a telemetry capture JSONL file.');
const capture = await readFile(process.argv[2], 'utf8');
// A running capture may have only partially written its final record.
const complete = capture.endsWith('\n') ? capture : capture.slice(0, capture.lastIndexOf('\n') + 1);
const lines = complete.split(/\r?\n/).filter(Boolean);
const rows = lines.map((line) => JSON.parse(line));
let sessionId = 'initial-buffer';
let previousGeneration = null;
let serial = 0;
const snapshots = [];
const sessions = [];
const missionStates = [];
const schemas = new Map();
for (const row of rows) {
  if (!row.endpoint || row.error || !row.data) continue;
  const fields = schemas.get(row.endpoint) ?? new Set();
  const keys = Array.isArray(row.data.keys)
    ? row.data.keys
    : Array.isArray(row.data)
      ? row.data.flatMap((record) => Object.keys(record))
      : Object.keys(row.data);
  for (const key of keys) fields.add(key);
  schemas.set(row.endpoint, fields);
  if (row.endpoint === 'map_info.json') {
    if (row.data.valid === true && row.data.map_generation !== previousGeneration) {
      previousGeneration = row.data.map_generation;
      sessionId = `observed-map-${++serial}`;
      sessions.push({ sessionId, generation: previousGeneration, firstObservedAt: row.capturedAt, leftAt: null });
    } else if (row.data.valid === false && sessions.length > 0 && !sessions.at(-1).leftAt) {
      sessions.at(-1).leftAt = row.capturedAt;
    }
  }
  if (row.endpoint === 'mission.json') missionStates.push({ observedAt: row.capturedAt, ...row.data });
  if (row.endpoint.startsWith('hudmsg')) {
    snapshots.push({ sessionId, ...row.data });
  }
}

const events = collectCombatEvents(snapshots);
const participants = new Map();
for (const event of events) {
  if (!event.parsed) continue;
  const key = JSON.stringify([event.sessionId, event.parsed.actor.name]);
  const counts = participants.get(key) ?? {
    sessionId: event.sessionId, name: event.parsed.actor.name,
    destroyed: 0, shot_down: 0, critical_damage: 0, severe_damage: 0, crashed: 0,
  };
  counts[event.parsed.action]++;
  participants.set(key, counts);
}

console.log(JSON.stringify({
  firstSample: rows[0]?.capturedAt,
  lastSample: rows.at(-1)?.capturedAt,
  caveat: 'Observed messages only. Not authoritative player kills, deaths, match results, or a complete roster. The initial buffer may predate capture. A map generation is not proof of a competitive battle.',
  sessions,
  missionStates,
  observedParticipants: [...participants.values()],
  parsedEvents: events.filter((event) => event.parsed).length,
  unparsedEvents: events.filter((event) => !event.parsed).map(({ id, message, sessionId }) => ({ sessionId, id, message })),
  schemas: Object.fromEntries([...schemas].map(([endpoint, keys]) => [endpoint, [...keys].sort()])),
}, null, 2));
