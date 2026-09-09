import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCombatEvents, parseCombatMessage } from './lib/combat-events.mjs';

// Captured test-flight wording; nickname replaced with a fixture identity.
const flight = [
  { id: 1, msg: 'TestPilot (A7M1) уничтожил Studebaker US6', time: 34 },
  { id: 2, msg: 'TestPilot (A7M1) уничтожил Studebaker US6', time: 38 },
  { id: 3, msg: 'TestPilot (A7M1) уничтожил Studebaker US6', time: 73 },
  { id: 4, msg: 'TestPilot (A7M1) уничтожил Studebaker US6', time: 99 },
  { id: 5, msg: 'TestPilot (A7M1) уничтожил Marder A1-', time: 107 },
  { id: 6, msg: 'TestPilot (A7M1) уничтожил Marder A1-', time: 120 },
  { id: 7, msg: 'TestPilot (A7M1) разбился', time: 139 },
];

test('replayed API snapshots produce six destructions and one crash exactly once', () => {
  const events = collectCombatEvents([
    { sessionId: 'test-flight', damage: flight.slice(0, 3) },
    { sessionId: 'test-flight', damage: flight },
    { sessionId: 'test-flight', damage: flight },
  ]);
  assert.equal(events.length, 7);
  assert.equal(events.filter((event) => event.parsed.action === 'destroyed').length, 6);
  assert.equal(events.filter((event) => event.parsed.action === 'crashed').length, 1);
  assert.ok(events.every((event) => event.parsed.target?.participantCandidate == null));
});

test('retained old messages are not reassigned to a new battle', () => {
  const events = collectCombatEvents([
    { sessionId: 'one', damage: flight },
    { sessionId: 'two', damage: [...flight, { id: 8, time: 131, msg: 'OtherPilot (Wyvern) уничтожил Бронеавтомобиль' }] },
  ]);
  assert.equal(events.length, 8);
  assert.equal(events.filter((event) => event.sessionId === 'two').length, 1);
  assert.equal(events.at(-1).parsed.actor.name, 'OtherPilot');
});

test('a reused ID with different content can represent a new event', () => {
  const events = collectCombatEvents([
    { sessionId: 'one', damage: flight },
    { sessionId: 'two', damage: [{ id: 1, time: 12, msg: 'OtherPilot (Wyvern) уничтожил Бронеавтомобиль' }] },
  ]);
  assert.equal(events.length, 8);
});

test('a candidate victim name is preserved without claiming verified identity', () => {
  const parsed = parseCombatMessage('=TAG= Pilot (A7M1) уничтожил Other (P-51D-30)');
  assert.deepEqual(parsed.target, {
    text: 'Other (P-51D-30)', explicitlyAi: false,
    participantCandidate: { name: 'Other', vehicle: 'P-51D-30' },
  });
  assert.equal(parsed.actor.name, '=TAG= Pilot');
});

test('unknown messages cannot silently become kills, rewards, or losses', () => {
  for (const message of ['running', 'Победа!', 'Попадание', 'Pilot покинул игру', 'TestPilot (A7M1) ударил первым!', '', null]) {
    assert.equal(parseCombatMessage(message), null);
  }
  const events = collectCombatEvents([{ sessionId: 'one', damage: [{ id: 8, time: 200, msg: 'New event' }] }]);
  assert.equal(events[0].parsed, null);
  assert.equal(events[0].message, 'New event');
});

test('records without an established session are not assigned to today', () => {
  assert.deepEqual(collectCombatEvents([{ damage: flight }]), []);
});

test('critical, severe, and final damage remain distinct events', () => {
  const messages = [
    '=TAG= Pilot (Як-3) нанёс критическое повреждение Other (␗IL-10)',
    '=TAG= Pilot (Як-3) нанёс фатальное повреждение Other (␗IL-10)',
    '=TAG= Pilot (Як-3) сбил Other (␗IL-10)',
  ];
  assert.deepEqual(messages.map((message) => parseCombatMessage(message).action), [
    'critical_damage', 'severe_damage', 'shot_down',
  ]);
  assert.deepEqual(parseCombatMessage(messages[2]).target.participantCandidate, { name: 'Other', vehicle: '␗IL-10' });
  assert.equal(parseCombatMessage('Other потерял связь'), null);
  assert.equal(parseCombatMessage('Othertd! kd?NET_PLAYER_DISCONNECT_FROM_GAME'), null);
});

test('explicit AI labels are preserved and aircraft variants are not verified player names', () => {
  const ai = parseCombatMessage('Pilot (Як-3У) уничтожил [ии] Су-6 (АМ-42)');
  assert.deepEqual(ai.target, {
    text: '[ии] Су-6 (АМ-42)', explicitlyAi: true, participantCandidate: null,
  });
  const ambiguous = parseCombatMessage('Pilot (Як-3У) нанёс критическое повреждение Су-6 (АМ-42)');
  assert.equal(ambiguous.target.explicitlyAi, false);
  assert.equal(ambiguous.target.text, 'Су-6 (АМ-42)');
  assert.equal(Object.hasOwn(ambiguous.target, 'name'), false);
});

test('nested aircraft variants and nickname parentheses stay intact', () => {
  const parsed = parseCombatMessage('=TAG= Pilot (ace) (Су-6 (АМ-42)) уничтожил ПВО');
  assert.deepEqual(parsed.actor, { name: '=TAG= Pilot (ace)', vehicle: 'Су-6 (АМ-42)' });
  assert.equal(parsed.target.text, 'ПВО');
});
