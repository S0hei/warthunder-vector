import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { baseKind, baseTeam } from '../app/lib/base-markers.ts';

test('bombing and defending bases are distinct from spawn points and other contacts', () => {
  assert.equal(baseKind({ type: 'bombing_point' }), 'bombing');
  assert.equal(baseKind({ type: 'defending_point' }), 'defending');
  for (const type of ['respawn_base_bomber', 'respawn_base_fighter', 'airfield', 'ground_model', 'aircraft', 'capture_zone', undefined]) {
    assert.equal(baseKind({ type, icon: 'bombing_point' }), null);
  }
});

test('reported red and blue base colors map to their respective team palettes', () => {
  for (const color of ['#fa0C00', '#f00C00', '#f20C00', '#f40C00', '#ff0000', '#ff6559', '#f00']) {
    assert.equal(baseTeam({ color }), 'enemy', color);
  }
  for (const color of ['#174DFF', '#185AFF', '#74d1ff', '#82d9ff', '#00f', ' #174dff ']) {
    assert.equal(baseTeam({ color }), 'friendly', color);
  }
});

test('team color comes from the feed, never from bombing versus defending semantics', () => {
  for (const type of ['bombing_point', 'defending_point', 'airfield']) {
    assert.equal(baseTeam({ type, color: '#ff0000' }), 'enemy');
    assert.equal(baseTeam({ type, color: '#174DFF' }), 'friendly');
    assert.equal(baseTeam({ type }), 'neutral');
  }
});

test('neutral, yellow, green, missing and malformed colors do not become blue or red bases', () => {
  for (const color of ['#faC81E', '#ffff00', '#39D921', '#aaa', '#000', '#fff', '', undefined, null, 42, 'rgb(255,0,0)', '#fa0C00xx', '#1234']) {
    assert.equal(baseTeam({ color }), 'neutral', String(color));
  }
});

test('base symbols have transparent thin outlines and a small team-colored center dot', () => {
  const symbol = readFileSync(new URL('../app/base-symbol.tsx', import.meta.url), 'utf8');
  assert.match(symbol, /kind === 'bombing'/);
  assert.match(symbol, /<circle[^>]*fill="none"[^>]*strokeWidth="1"/);
  assert.match(symbol, /<rect[^>]*fill="none"[^>]*strokeWidth="1"/);
  assert.match(symbol, /r="1\.65" fill="currentColor"/);
  assert.match(symbol, /aria-hidden="true"/);
});

test('bases bypass the gold diamond and letter glyph while retaining filters and selection', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /const geometryMarker = !base &&/);
  assert.match(page, /base \? <BaseSymbol kind=\{base\}/);
  assert.match(page, /base base-\$\{team\}/);
  assert.match(page, /if \(!filters\[groupFor\(object\)\]\) return null/);
  assert.match(page, /setSelectedIndex\(index\)/);
  assert.doesNotMatch(page, /if \(object\.type === '(?:bombing_point|defending_point)'\) return '[BD]'/);
});

test('base and runway palettes stay consistent, neutral is explicit, and symbols stay compact', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  for (const team of ['friendly', 'enemy']) {
    assert.ok(css.includes(`.map-marker.base.base-${team} { color: var(--base-${team}); }`));
    assert.ok(css.includes(`.runway.${team} { color: var(--base-${team}); }`));
  }
  assert.match(css, /\.map-marker\.base \{[^}]*background: transparent;[^}]*color: var\(--base-neutral\)/s);
  assert.match(css, /\.base-symbol \{[^}]*width: 1\.25rem;[^}]*height: 1\.25rem;[^}]*pointer-events: none/s);
  assert.match(page, /className=\{`runway \$\{team\}`\}/);
});
