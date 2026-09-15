import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentLoader } from './component-test-loader.mjs';
const read = name => readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8');

test('the footer keeps the download action but removes technical connection labels', () => {
  const page = read('page.tsx');
  assert.doesNotMatch(page, /WT :8111|Local \/ Read-only/);
  assert.match(page, /<footer className="panel-footer">\s*<a className="github-download"/);
  assert.match(page, /className="map-heading"[\s\S]*className=\{`connection-pill/);
  const dock = page.slice(page.indexOf('<div className="map-dock">'), page.indexOf('<aside className="intel-panel">'));
  for (const name of ['map-tools', 'filter-bar', 'scale-bar']) assert.ok(dock.includes(`className="${name}"`));
  const css = read('globals.css');
  assert.match(css, /\.map-dock \.filter-bar\s*\{[^}]*min-width: 0;[^}]*flex-wrap: wrap/);
  assert.match(css, /@container \(max-width: 70rem\)\s*\{\s*\.map-dock\s*\{ grid-template-columns: minmax\(0, 1fr\) auto;/);
});

test('short battle labels retain known-player meaning and unavailable time stays explicit', () => {
  const Component = componentLoader()('battle-status-strip.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Component, { connected: true, now: 2000,
    battle: { alliesAlive: 16, enemiesAlive: 0, clockStartedAt: null, scannedAt: 2000 } }));
  assert.match(html, /title="Known allies alive"/); assert.match(html, /title="Known enemies alive"/);
  assert.match(html, />Allies<\/span>/); assert.match(html, />Enemies<\/span>/);
  assert.match(html, /<strong>0<\/strong>/); assert.match(html, /aria-label="N\/A"[^>]*>--:--<\/strong>/);
});

test('empty result cards are visually quieter without turning unavailable metrics into zeros', () => {
  const Component = componentLoader()('file-battles-panel.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Component, { account: undefined, accounts: [], onAccountChange() {},
    archive: { connection: 'connected', status: 'ready', paused: false, startedAt: new Date().toISOString(), unreadable: 0, rejected: 0, battles: [] } }));
  assert.equal((html.match(/class="is-unavailable"/g) ?? []).length, 5);
  assert.match(html, /No battles in this period/);
  assert.doesNotMatch(html, /Stats from 0\/0 battles|0 battles confirmed/);
  const css = read('globals.css');
  assert.match(css, /\.battle-results \.is-unavailable\s*\{[^}]*font-size: 1rem/);
});
