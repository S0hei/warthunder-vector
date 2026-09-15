import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LiveBattleTracker, battleClock, BATTLE_STATUS_FRESH_MS } from '../app/lib/live-battle.ts';
import { componentLoader } from './component-test-loader.mjs';
const now = Date.parse('2026-09-15T17:30:00Z');
const map = { valid: true, map_generation: 4 };
const hud = { events: [], damage: [{ id: 12, time: 80, msg: 'Pilot (Yak) shot down Foe (Bf 109)' }] };
const native = (values = {}) => ({ schemaVersion: 1, sessionId: 'abcdefab', scannedAt: new Date(now).toISOString(),
  summary: { active: true, joinedAt: new Date(now - 180000).toISOString(), alliesAlive: 7, enemiesAlive: 4 },
  events: [{ message: hud.damage[0].msg, observedAt: new Date(now - 20000).toISOString() }], ...values });

test('battle clock matches game event time to its log timestamp, not the app opening time', () => {
  const tracker = new LiveBattleTracker(); tracker.observe(map, hud, map); tracker.annotate(native(), now);
  assert.deepEqual(tracker.snapshot(now), { alliesAlive: 7, enemiesAlive: 4, clockStartedAt: now - 100000, scannedAt: now });
  assert.equal(battleClock(tracker.snapshot(now).clockStartedAt, now + 3500), '01:43');
});
test('no event match leaves time unavailable while roster counts still work; real zero stays zero', () => {
  const tracker = new LiveBattleTracker(); tracker.observe(map, { events: [], damage: [] }, map);
  tracker.annotate(native({ summary: { ...native().summary, alliesAlive: 0, enemiesAlive: 0 } }), now);
  assert.equal(tracker.snapshot(now).clockStartedAt, null); assert.equal(tracker.snapshot(now).alliesAlive, 0);
  assert.equal(battleClock(null, now), null);
});
test('stale, inactive, malformed and legacy native feeds never become apparent live player totals', () => {
  for (const payload of [{}, { schemaVersion: 1, sessionId: 'abcdefab', events: [] }, native({ scannedAt: new Date(now - 16000).toISOString() }),
    native({ scannedAt: new Date(now + 60000).toISOString() }), native({ summary: { ...native().summary, active: false } }),
    native({ summary: { ...native().summary, enemiesAlive: -1 } }), native({ summary: { ...native().summary, alliesAlive: 99999 } })]) {
    const tracker = new LiveBattleTracker(); tracker.observe(map, hud, map); tracker.annotate(payload, now); assert.equal(tracker.snapshot(now), null);
  }
  const tracker = new LiveBattleTracker(); tracker.observe(map, hud, map); tracker.annotate(native(), now);
  assert.equal(tracker.snapshot(now + BATTLE_STATUS_FRESH_MS + 1), null);
});
test('a map transition rejects the previous log session even if it is still being served', () => {
  const tracker = new LiveBattleTracker(); tracker.observe(map, hud, map); tracker.annotate(native(), now);
  const next = { ...map, map_generation: 5 }; tracker.observe(next, { damage: [] }, next); tracker.annotate(native(), now);
  assert.equal(tracker.snapshot(now), null);
  tracker.annotate(native({ sessionId: '12345678', events: [] }), now);
  assert.equal(tracker.snapshot(now).clockStartedAt, null); assert.equal(tracker.snapshot(now).enemiesAlive, 4);
});
test('hangar, mixed map responses, disconnect and HUD rollback clear live battle data', () => {
  for (const transition of ['hangar', 'mixed', 'disconnected', 'rollback']) {
    const tracker = new LiveBattleTracker(); tracker.observe(map, hud, map); tracker.annotate(native(), now);
    if (transition === 'disconnected') tracker.disconnected();
    else if (transition === 'rollback') { tracker.observe(map, { damage: [{ ...hud.damage[0], id: 1 }] }, map); tracker.annotate(native(), now); }
    else tracker.observe(map, hud, transition === 'hangar' ? { valid: false } : { ...map, map_generation: 5 });
    assert.equal(tracker.snapshot(now), null, transition);
  }
});
test('timer formatting is bounded and preserves minute rollover', () => {
  assert.equal(battleClock(now - 59000, now), '00:59'); assert.equal(battleClock(now - 60000, now), '01:00');
  assert.equal(battleClock(now - 3600000, now), '60:00'); assert.equal(battleClock(now + 5000, now), null);
  assert.equal(battleClock(NaN, now), null); assert.equal(battleClock(now - 86401000, now), null);
});
test('map header shows both colored known-player counters and unavailable data in English and Russian', () => {
  const lang = componentLoader()('lib/language.ts');
  for (const language of ['en', 'ru']) {
    const Component = componentLoader({ './language-provider': { useTranslation: () => ({ t: text => lang.translate(language, text), number: value => lang.localizedNumber(language, value), notAvailable: lang.translate(language, 'N/A') }) } })('battle-status-strip.tsx').default;
    const battle = { alliesAlive: 7, enemiesAlive: 0, clockStartedAt: now - 100000, scannedAt: now };
    const html = renderToStaticMarkup(React.createElement(Component, { battle, connected: true, now }));
    assert.ok(html.includes(lang.translate(language, 'Known allies alive'))); assert.ok(html.includes(lang.translate(language, 'Known enemies alive')));
    assert.match(html, /battle-allies/); assert.match(html, /battle-enemies/); assert.match(html, /01:40/); assert.match(html, /<strong>0<\/strong>/);
    const stale = renderToStaticMarkup(React.createElement(Component, { battle, connected: false, now }));
    assert.ok(stale.includes(lang.translate(language, 'N/A'))); assert.doesNotMatch(stale, /01:40/);
  }
});
test('download link is available in every panel and opens only the fixed GitHub release page', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /<footer className="panel-footer">[\s\S]*href="https:\/\/github.com\/S0hei\/warthunder-vector\/releases\/latest" target="_blank" rel="noopener noreferrer"/);
  assert.match(page, /<BattleStatusStrip battle=\{activity.battle\} connected=\{connected\} now=\{clock\}/);
});
