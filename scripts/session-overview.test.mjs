import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { showSessionOverview, sessionBattles } from '../app/lib/session-overview.ts';
import { summarizeFileBattles } from '../app/lib/file-battles.ts';

test('startup, a confirmed invalid map and a stopped game show the session overview', () => {
  assert.equal(showSessionOverview(false, 0, 0, 100000), true);
  assert.equal(showSessionOverview(false, 100000, 100000, 100100), true);
  assert.equal(showSessionOverview(undefined, 100000, 100000, 100100), true);
  assert.equal(showSessionOverview(true, 100000, 100000, 115001), true);
});

test('a valid battle map stays visible for respawning, spectating and short feed outages', () => {
  // No player-object or contact-count requirement: a valid map is sufficient.
  assert.equal(showSessionOverview(true, 100000, 100000, 100100), false);
  assert.equal(showSessionOverview(true, 100000, 100000, 110000), false);
  assert.equal(showSessionOverview(true, 100000, 140000, 140100), false);
  assert.equal(showSessionOverview(true, 140000, 100000, 140100), false);
});

test('returning to the hangar and entering another battle switches surfaces without losing history', () => {
  const states = [[false, 0, 0, 1000], [true, 2000, 2000, 2100], [false, 3000, 3000, 3100], [true, 4000, 4000, 4100]];
  assert.deepEqual(states.map(s => showSessionOverview(...s)), [true, false, true, false]);
});

const battle = (id, playedAt, accountId = '42') => ({ id, accountId, playedAt, outcome: 'win', conflict: false,
  hasReplay: true, rewardsFinal: true, kills: 3, groundKills: 1, navalKills: 0, deaths: 1, spawns: 2,
  aiKills: 2, aiGroundKills: 0, aiNavalKills: 0, wp: 1000, exp: 200 });

test('session scope uses play time since Vector started and never pools accounts or backfilled old battles', () => {
  const first = battle('aaaaaaaa', '2026-09-08T20:00:00Z');
  const latest = battle('bbbbbbbb', '2026-09-09T01:00:00Z');
  const old = battle('cccccccc', '2026-09-08T19:59:59Z');
  const other = battle('dddddddd', '2026-09-09T01:01:00Z', '43');
  const input = [old, first, other, latest];
  const selected = sessionBattles(input, '42', '2026-09-08T20:00:00Z');
  assert.deepEqual(selected, [latest, first]);
  assert.deepEqual(input, [old, first, other, latest]);
  assert.equal(sessionBattles(input, '43', '2026-09-08T20:00:00Z').length, 1);
  const totals = summarizeFileBattles(selected);
  assert.equal(totals.kd, 4); assert.equal(totals.ks, 2); assert.equal(totals.wp, 2000);
});

test('unknown or restarted sessions do not silently fall back to daily or all-time history', () => {
  const saved = [battle('aaaaaaaa', '2026-09-08T20:00:00Z')];
  assert.deepEqual(sessionBattles(saved, '42', null), []);
  assert.deepEqual(sessionBattles(saved, '42', 'invalid'), []);
  assert.deepEqual(sessionBattles(saved, undefined, '2026-09-08T20:00:00Z'), []);
  assert.deepEqual(sessionBattles(saved, '42', '2026-09-08T20:01:00Z'), []);
});

test('overview and Results share one collector and account selection; map gestures are disabled in the overview', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const panel = readFileSync(new URL('../app/file-battles-panel.tsx', import.meta.url), 'utf8');
  assert.equal((page.match(/useFileArchive\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(panel, /useFileArchive\(\)/);
  for (const component of ['SessionOverview', 'FileBattlesPanel']) assert(page.includes(`<${component} archive={archive} account={account} accounts={accounts}`));
  for (const gesture of ['onPointerDown', 'onPointerMove', 'onPointerUp', 'onDoubleClick']) assert(page.includes(`${gesture}={overview ? undefined :`));
  assert(page.includes('if (overview) return;'));
});

test('overview layout scales and scrolls without hiding data under the mobile sidebar', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.map-stage\.overview-stage\s*\{[^}]*overflow: auto[^}]*touch-action: auto/);
  assert.match(css, /\.session-table-wrap\s*\{[^}]*overflow: auto/);
  assert.match(css, /\.session-mode \.intel-panel\s*\{[^}]*position: static/);
  assert.match(css, /\.session-metrics dd\s*\{[^}]*font-size: clamp\(/);
});
