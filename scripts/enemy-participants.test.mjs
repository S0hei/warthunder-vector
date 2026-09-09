import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CombatActivityTracker } from '../app/lib/combat-activity.ts';
import { componentLoader } from './component-test-loader.mjs';

const load = componentLoader(), Table = load('enemy-participants.tsx').default;
const sample = (damage, generation = 1) => ({ before: { valid: generation !== null, map_generation: generation }, after: { valid: generation !== null, map_generation: generation }, hud: { damage } });
const event = (id, msg, time = id * 10) => ({ id, msg, time });
const fixture = () => { const tracker = new CombatActivityTracker(); tracker.ingest(sample([]), 100000); return tracker; };
const annotation = (record, actorTeam = 'self', targetTeam = 'enemy', observedAt = 101000) => ({ message: record.msg,
  observedAt: new Date(observedAt).toISOString(), actorTeam, targetTeam, targetInRoster: true });
const annotate = (tracker, entries) => tracker.annotate({ schemaVersion: 1, sessionId: 'abcdefab', events: entries });
const render = (participants, extra = {}) => renderToStaticMarkup(React.createElement(Table, { participants, status: 'live', search: '', selectedName: null, ...extra }));

test('received damage belongs to the target, not the attacker or their outgoing totals', () => {
  const t = fixture(), hit = event(1, 'Pilot (Yak) critically damaged Foe (g_55s)');
  t.ingest(sample([hit]), 101000);
  const a = annotate(t, [annotation(hit)]);
  assert.equal(a.participants.find(p => p.name === 'Pilot').lastDamage, null);
  assert.equal(a.participants.find(p => p.name === 'Foe').lastDamage.action, 'critical_damage');
  assert.equal(a.rows[0].critical_damage, 1);
  const html = render(a.participants);
  assert.match(html, /Foe/); assert.match(html, /G\.55S/); assert.match(html, /Critical/);
  assert.doesNotMatch(html, />Pilot</);
});

test('one compact row per known enemy excludes allies, self and unknown teams', () => {
  const participants = ['enemy', 'ally', 'self', 'unknown'].map((team, i) => ({ name: `Name${i}`, vehicle: 'g_55s', team, lastDamage: null }));
  const html = render(participants);
  assert.match(html, /Nickname/); assert.match(html, /Aircraft/); assert.match(html, /Last damage/);
  assert.match(html, /Name0/); assert.doesNotMatch(html, /Name[123]/);
  assert.match(html, /Unknown/); assert.doesNotMatch(html, /Healthy|Undamaged|100%/);
  assert.equal((html.match(/scope="row"/g) ?? []).length, 1);
});

test('damage persists through outgoing events but resets when a different aircraft is observed', () => {
  const t = fixture();
  const hit = event(1, 'Pilot (Yak) critically damaged Foe (g_55s)');
  t.ingest(sample([hit]), 101000); annotate(t, [annotation(hit)]);
  const before = t.snapshot();
  const outgoing = event(2, 'Foe (g_55s) destroyed ПВО');
  t.ingest(sample([hit, outgoing]), 102000);
  assert.equal(t.snapshot().participants.find(p => p.name === 'Foe').lastDamage.action, 'critical_damage');
  const changed = event(3, 'Foe (yak-3u) destroyed ПВО');
  t.ingest(sample([hit, outgoing, changed]), 103000);
  const foe = t.snapshot().participants.find(p => p.name === 'Foe');
  assert.equal(foe.vehicle, 'yak-3u'); assert.equal(foe.lastDamage, null);
  assert.equal(before.participants.find(p => p.name === 'Foe').vehicle, 'g_55s');
  assert.equal(before.participants.find(p => p.name === 'Foe').lastDamage.action, 'critical_damage');
});

test('a later shot down or crash is retained as a report, not a health estimate', () => {
  const t = fixture();
  const records = [event(1, 'Foe (Yak) destroyed ПВО'), event(2, 'Pilot (Spitfire) severely damaged Foe (Yak)'), event(3, 'Pilot (Spitfire) shot down Foe (Yak)')];
  t.ingest(sample(records), 101000);
  let a = annotate(t, records.map(r => annotation(r, r.id === 1 ? 'enemy' : 'self', 'enemy')));
  assert.equal(a.participants.find(p => p.name === 'Foe').lastDamage.action, 'shot_down');
  assert.match(render(a.participants), /Shot down/);
  const crash = event(4, 'Foe (Yak) crashed');
  t.ingest(sample([...records, crash]), 102000);
  a = annotate(t, [annotation(crash, 'enemy', 'unknown', 102000)]);
  assert.equal(a.participants.find(p => p.name === 'Foe').lastDamage.action, 'crashed');
  assert.match(render(a.participants), /Crashed/);
});

test('delayed annotations recover damage for the same observed aircraft without changing the latest plane', () => {
  const t = fixture();
  const first = event(1, 'Foe (Yak) destroyed ПВО');
  const hit = event(2, 'Pilot (Spitfire) critically damaged Foe (Yak)');
  const latest = event(3, 'Foe (Yak) destroyed ПВО');
  // Simulate a late record in the HUD buffer and its later roster confirmation.
  t.ingest(sample([first, latest, hit]), 101000);
  const a = annotate(t, [annotation(first, 'enemy'), annotation(latest, 'enemy'), annotation(hit)]);
  const foe = a.participants.find(p => p.name === 'Foe');
  assert.equal(foe.time, 30); assert.equal(foe.lastDamage.time, 20);
  assert.equal(foe.team, 'enemy');
  const changed = event(4, 'Foe (Spitfire) destroyed ПВО'), returnToYak = event(5, 'Foe (Yak) destroyed ПВО');
  t.ingest(sample([first, hit, latest, changed, returnToYak]), 102000);
  annotate(t, [annotation(hit)]);
  assert.equal(t.snapshot().participants.find(p => p.name === 'Foe').lastDamage, null);
});

test('damage reports survive event pruning, never leak to the next flight and are not recounted', () => {
  const t = fixture(), hit = event(1, 'Pilot (Yak) critically damaged Foe (g_55s)');
  t.ingest(sample([hit]), 101000); annotate(t, [annotation(hit)]);
  const rest = Array.from({ length: 70 }, (_, i) => event(i + 2, 'Pilot (Yak) destroyed ПВО'));
  t.ingest(sample([hit, ...rest]), 102000);
  assert.equal(t.snapshot().recent.length, 60);
  assert.equal(t.snapshot().participants.find(p => p.name === 'Foe').lastDamage.action, 'critical_damage');
  assert.match(render(t.snapshot().participants, { status: 'paused' }), /Last flight enemies/);
  const count = t.snapshot().eventCount;
  annotate(t, [annotation(hit)]); assert.equal(t.snapshot().eventCount, count);
  assert.equal(t.ingest(sample([], 2), 103000).participants.length, 0);
});

test('enemy table searches readable aircraft names and exact nickname selections', () => {
  const participants = [
    { name: 'Pilot', vehicle: 'g_55s', team: 'enemy' },
    { name: 'PilotTwo', vehicle: 'yak-3u', team: 'enemy' },
  ];
  assert.match(render(participants, { search: 'G.55S' }), />Pilot</);
  assert.doesNotMatch(render(participants, { search: 'G.55S' }), /PilotTwo/);
  assert.doesNotMatch(render(participants, { selectedName: 'Pilot' }), /PilotTwo/);
  assert.match(render(participants, { search: 'missing' }), /No matching enemies/);
  assert.match(render([], { status: 'waiting' }), /Waiting for a battle/);
});

test('compact picker mode avoids duplicating the selected enemy aircraft card', () => {
  const Picker = load('activity-player-picker.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Picker, { participants: [{ name: 'Foe', vehicle: 'Yak', team: 'enemy', observedAt: 101000 }],
    search: 'Foe', selectedName: 'Foe', status: 'live', compact: true, onChange() {} }));
  assert.match(html, /role="combobox"/);
  assert.doesNotMatch(html, /activity-picked|Last observed aircraft/);
});

test('table keeps three readable columns, text-scaled compact spacing and scroll access', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.enemy-table \{[^}]*min-width: 21rem[^}]*font-size: \.875rem/);
  assert.match(css, /\.enemy-table-wrap \{[^}]*overflow: auto/);
  assert.match(css, /\.enemy-table tbody th, \.enemy-table tbody td \{[^}]*padding: \.55rem \.45rem/);
  const html = render([{ name: '<script>enemy</script>', vehicle: 'Yak', team: 'enemy' }]);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 3);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
});
