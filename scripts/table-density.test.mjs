import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentLoader } from './component-test-loader.mjs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const compact = css.slice(css.indexOf('/* Compact table rhythm:'), css.indexOf('/* Keep the native select'));

test('all table families use less vertical space without shrinking text or clipping content', () => {
  for (const name of ['results-table', 'enemy-table', 'activity-table', 'contact-log', 'session-table']) {
    assert.ok(compact.includes(`.${name}`), name);
  }
  assert.doesNotMatch(compact, /font-size|line-height|overflow:\s*hidden|text-overflow|display:\s*none|transform|zoom:/);
  assert.match(compact, /\.results-table \.result-match \{ min-height: 2\.75rem; padding: \.5rem/);
  assert.match(compact, /\.contact-log tbody tr\[role='button'\] \{ height: 2rem/);
  assert.match(compact, /\.session-table tbody th, \.session-table td \{ padding-top: \.625rem/);
  assert.match(compact, /\.enemy-table tbody th, \.enemy-table tbody td \{ padding-top: \.375rem/);
  assert.match(compact, /\.combat-event \{ padding: \.5625rem 0/);
});

test('compact metadata wraps naturally and empty states no longer reserve oversized rows', () => {
  assert.match(compact, /\.result-outcome \{ display: flex; flex-wrap: wrap;/);
  assert.match(compact, /\.result-outcome time \{ display: inline; margin: 0; white-space: nowrap;/);
  assert.match(compact, /\.file-battle-ai \{ display: inline-block;/);
  assert.match(compact, /\.result-kills \{ display: flex; flex-wrap: wrap;/);
  assert.match(compact, /\.results-table \.results-empty, \.enemy-table \.enemy-empty \{ padding: 1rem/);
  assert.match(css, /\.results-table thead \.battle-stat-label, \.session-table thead \.battle-stat-label \{[^}]*flex-wrap: wrap/);
});

test('compact battle rows retain dates, all aircraft, zero AI counts and accessible details', () => {
  const now = new Date().toISOString();
  const battle = { schemaVersion: 1, id: 'abcdefab', accountId: '42', player: 'Pilot', playedAt: now,
    mission: 'avg_egypt_sinai', outcome: 'win', conflict: false, hasLog: true, hasReplay: true,
    rewardsFinal: true, wp: 5000, exp: 1200, kills: 3, groundKills: 0, navalKills: 0,
    aiKills: 0, aiGroundKills: 0, aiNavalKills: 0, assists: 0, deaths: 0, spawns: null,
    score: 1500, seconds: 500, vehicles: ['yak-3p', 'spitfire_mk5c'] };
  const Panel = componentLoader()('file-battles-panel.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Panel, { account: '42', accounts: [['42', 'Pilot']], onAccountChange() {},
    archive: { connection: 'connected', status: 'ready', paused: false, startedAt: now, unreadable: 0, rejected: 0, battles: [battle] } }));
  assert.match(html, /class="result-outcome win"><span>Victory<\/span><time dateTime=/);
  assert.ok(html.includes(now));
  assert.match(html, /class="file-battle-ai">\+0 AI<\/small>/);
  assert.match(html, /class="result-kills"><span>3<\/span>/);
  assert.match(html, /<td>0<\/td><td>N\/A<\/td>/);
  assert.match(html, /aria-expanded="false" aria-controls="battle-/);
  assert.match(html, /<tr id="battle-[^"]+" hidden=""/);
  assert.equal((html.match(/class="aircraft-identity"/g) ?? []).length, 2);
  assert.match(html, /class="aircraft-flag"/);
});
