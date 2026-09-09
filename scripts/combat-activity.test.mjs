import test from 'node:test';
import assert from 'node:assert/strict';
import { CombatActivityTracker } from '../app/lib/combat-activity.ts';

const map = (generation = 1) => ({ valid: true, map_generation: generation });
const hangar = { valid: false };
const event = (id, msg = 'Pilot (Як-3У) уничтожил [ии] Су-6 (АМ-42)', time = id * 10) => ({ id, msg, time });
const sample = (damage, before = map(), after = before) => ({ before, after, hud: { events: [], damage } });

const annotations = (events) => ({ schemaVersion: 1, sessionId: '123456789abcdef', events });
const annotation = (msg, observedAt, actorTeam = 'ally', targetTeam = 'enemy') => ({ message: msg, observedAt: new Date(observedAt).toISOString(), actorTeam, targetTeam });

test('actor and damaged vehicle colors are independent and never affect event counts', () => {
  const t = new CombatActivityTracker(), msg = 'Pilot (Yak) нанёс критическое повреждение Friend (Bf 109)';
  t.ingest(sample([]), 100000); t.ingest(sample([event(1, msg)]), 101000);
  const before = t.snapshot(); const after = t.annotate(annotations([annotation(msg, 100500, 'self', 'ally')]));
  assert.equal(after.eventCount, 1); assert.equal(after.recent[0].actor.team, 'self');
  assert.equal(after.recent[0].target.team, 'ally'); assert.equal(after.recent[0].target.vehicle, 'Bf 109');
  assert.equal(after.rows[0].team, 'self'); assert.equal(before.rows[0].team, 'unknown');
});

test('unknown ground names can receive a source-validated team without inventing a player', () => {
  const t = new CombatActivityTracker(), msg = 'Pilot (Yak) уничтожил Лёгкий ДОТ';
  t.ingest(sample([]), 100000); t.ingest(sample([event(1, msg)]), 101000);
  const after = t.annotate(annotations([annotation(msg.replace(' ', ' '), 100500)]));
  assert.equal(after.recent[0].target.name, null); assert.equal(after.recent[0].target.team, 'enemy');
});

test('historical, malformed and ambiguous annotations never guess a side', () => {
  const t = new CombatActivityTracker(), msg = 'Pilot (Yak) уничтожил ПВО';
  t.ingest(sample([]), 100000); t.ingest(sample([event(1, msg)]), 101000);
  for (const payload of [null, {}, annotations([annotation(msg, 20000)]), annotations([annotation(msg, 120000)]),
    annotations([annotation(msg, 100500, '<script>')]), annotations([annotation(msg, 100500), annotation(msg, 100600, 'enemy', 'ally')])]) {
    const a = t.annotate(payload); assert.equal(a.recent[0].actor.team, 'unknown');
    assert.equal(a.recent[0].target.team, 'unknown');
  }
  t.ingest(sample([], map(2)), 200000); t.ingest(sample([event(1, msg)], map(2)), 201000);
  assert.equal(t.annotate(annotations([annotation(msg, 100500)])).rows[0].team, 'unknown');
});

test('clipboard import and copied report UI are absent from the runtime', async () => {
  const { readFile, access } = await import('node:fs/promises');
  const native = await readFile(new URL('../native/Vector.cs', import.meta.url), 'utf8');
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(native, /GameClipboard|GetClipboard|ReportStore|class Receipt/);
  assert.doesNotMatch(page, /useBattleResults|CopiedResultsPanel/);
  await assert.rejects(access(new URL('../app/lib/battle-reports.ts', import.meta.url)));
});

test('startup establishes a baseline instead of counting an ambiguous old buffer', () => {
  const tracker = new CombatActivityTracker();
  const result = tracker.ingest(sample([event(1)]), 1000);
  assert.equal(result.eventCount, 0);
  assert.equal(result.rows.length, 0);
  assert.equal(result.status, 'live');
  assert.equal(result.startedAt, 1000);
});

test('only new events count and AI is an included subtotal, not extra destructions', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([event(1)]), 1000);
  const records = [event(1), event(2), event(3, 'Pilot (Як-3У) уничтожил Бронеавтомобиль')];
  tracker.ingest(sample(records), 2000);
  const result = tracker.ingest(sample(records), 3000);
  assert.equal(result.eventCount, 2);
  assert.equal(result.rows[0].destroyed, 2);
  assert.equal(result.rows[0].aiDestroyed, 1);
  assert.equal(result.rows[0].shot_down, 0);
  assert.equal(result.recent.length, 2);
});

test('critical, severe, destruction, shoot-down, and crash columns remain independent', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  const messages = [
    'Pilot (Як-3У) нанёс критическое повреждение Other (␗IL-10)',
    'Pilot (Як-3У) нанёс фатальное повреждение Other (␗IL-10)',
    'Pilot (Як-3У) сбил Other (␗IL-10)',
    'Pilot (Як-3У) уничтожил [ии] Су-6 (АМ-42)',
    'Pilot (Як-3У) разбился',
    'Pilot потерял связь',
    'Pilot (Як-3У) получил "Спасатель наземной техники"',
    'Pilot (Як-3У) поджёг Other (␗IL-10)',
  ];
  const result = tracker.ingest(sample(messages.map((msg, i) => event(i + 1, msg))), 2000);
  const row = result.rows[0];
  assert.equal(result.eventCount, 5);
  for (const column of ['destroyed', 'shot_down', 'critical_damage', 'severe_damage', 'crashed']) assert.equal(row[column], 1);
  assert.equal(result.rows.length, 1); // No guessed victim identity or death total.
  assert.equal(row.aiDestroyed, 1);
  assert.equal(row.aiShotDown, 0);
});

test('actors and vehicles stay separate without clan stripping or guessed teams', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  const result = tracker.ingest(sample([
    event(1, '=TAG= 飞行员 (Су-6 (АМ-42)) уничтожил ПВО'),
    event(2, '=TAG= 飞行员 (Як-3У) уничтожил ПВО'),
    event(3, '飞行员 (Як-3У) уничтожил ПВО'),
  ]), 2000);
  assert.equal(result.rows.length, 3);
  assert.ok(result.rows.some((row) => row.vehicle === 'Су-6 (АМ-42)'));
  assert.ok(result.rows.every((row) => row.team === 'unknown' && !Object.hasOwn(row, 'isPlayer')));
});

test('hangar freezes the last activity and a new map excludes all retained messages', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  tracker.ingest(sample([event(1)]), 2000);
  const left = tracker.ingest(sample([event(1), event(2)], hangar), 3000);
  assert.equal(left.status, 'paused');
  assert.equal(left.eventCount, 1);
  assert.equal(tracker.ingest(sample([event(1), event(2)], hangar), 4000).eventCount, 1);
  const next = tracker.ingest(sample([event(1), event(2), event(3)], map(2)), 5000);
  assert.equal(next.eventCount, 0);
  assert.equal(next.startedAt, 5000);
  const live = tracker.ingest(sample([event(1), event(2), event(3), event(4)], map(2)), 6000);
  assert.equal(live.eventCount, 1);
  assert.equal(live.recent[0].time, 40);
});

test('a map change during a HUD request is re-baselined, never attributed to either sortie', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  tracker.ingest(sample([event(1)]), 2000);
  assert.equal(tracker.ingest(sample([event(1), event(2)], map(), map(2)), 3000).eventCount, 0);
  assert.equal(tracker.ingest(sample([event(1), event(2), event(3)], map(2)), 4000).eventCount, 0);
  assert.equal(tracker.ingest(sample([event(1), event(2), event(3), event(4)], map(2)), 5000).eventCount, 1);
});

test('offline retains the table and reconnect starts a fresh observation window', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  tracker.ingest(sample([event(1)]), 2000);
  const offline = tracker.disconnected();
  assert.equal(offline.status, 'offline');
  assert.equal(offline.eventCount, 1);
  assert.equal(offline.lastUpdate, 2000);
  const reconnected = tracker.ingest(sample([event(1), event(2)]), 5000);
  assert.equal(reconnected.status, 'live');
  assert.equal(reconnected.eventCount, 0);
  assert.equal(reconnected.startedAt, 5000);
  assert.equal(tracker.ingest(sample([event(1), event(2), event(3)]), 6000).eventCount, 1);
});

test('reused map generation or HUD IDs after a restart cannot pool previous activity', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([event(100)]), 1000);
  tracker.ingest(sample([event(100), event(101)]), 2000);
  assert.equal(tracker.ingest(sample([event(1)]), 3000).eventCount, 0);
  assert.equal(tracker.ingest(sample([event(1), event(2)]), 4000).eventCount, 1);
  tracker.ingest(sample([event(1), event(2)], hangar), 5000);
  assert.equal(tracker.ingest(sample([event(1), event(2)]), 6000).eventCount, 0);
});

test('malformed responses cannot silently clear the table or become fabricated events', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  tracker.ingest(sample([event(1)]), 2000);
  for (const invalid of [
    { before: {}, after: {}, hud: { damage: [] } },
    { before: map(), after: map(), hud: { damage: null } },
    { before: { valid: true }, after: map(), hud: { damage: [] } },
  ]) assert.throws(() => tracker.ingest(invalid, 3000));
  assert.equal(tracker.snapshot().eventCount, 1);
  const result = tracker.ingest(sample([
    event(1), null, {}, { ...event(2), time: NaN }, { ...event(3), id: '3' },
    { ...event(4), msg: 5 }, { ...event(5), time: -1 },
    event(6, 'x'.repeat(5000)), event(7, 'Победа!'),
  ]), 4000);
  assert.equal(result.eventCount, 1);
});

test('long sorties retain aggregate counts but bound the recent event list', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  const result = tracker.ingest(sample(Array.from({ length: 200 }, (_, i) => event(i + 1))), 2000);
  assert.equal(result.eventCount, 200);
  assert.equal(result.rows[0].destroyed, 200);
  assert.equal(result.recent.length, 60);
  assert.equal(result.recent[0].time, 1410);
});

test('old immutable snapshots do not gain counts during subsequent polls', () => {
  const tracker = new CombatActivityTracker();
  tracker.ingest(sample([]), 1000);
  const previous = tracker.ingest(sample([event(1)]), 2000);
  tracker.ingest(sample([event(1), event(2)]), 3000);
  assert.equal(previous.rows[0].destroyed, 1);
  assert.equal(previous.eventCount, 1);
});
