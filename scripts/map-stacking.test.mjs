import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
function layer(selector) {
  const matches = rules.filter(([, selectors, body]) => selectors.split(',').map(s => s.trim()).includes(selector) && /z-index:\s*\d+/.test(body));
  assert.equal(matches.length, 1, `One explicit stacking rule for ${selector}`);
  return Number(matches[0][2].match(/z-index:\s*(\d+)/)[1]);
}

test('own aircraft stays above overlapping contacts, highlights, remembered enemies and team pings', () => {
  const player = layer('.map-marker.player');
  for (const selector of ['.map-marker', '.map-marker:hover', '.map-marker.selected', '.map-marker.game-target', '.team-ping-marker', '.runway']) {
    assert.ok(player > layer(selector), `Player above ${selector}`);
  }
  // Equal-specificity hover/selection/target rules cannot override the player layer.
  const playerRule = css.indexOf('.map-marker.player {');
  assert.ok(playerRule > css.indexOf('.map-marker:hover,'));
  assert.ok(playerRule > css.indexOf('.map-marker.game-target {'));
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.ok(page.includes("${playerMarker ? 'player' : ''}"));
  assert.ok(page.includes('hostile memory'));
  assert.doesNotMatch(page, /zIndex\s*:/);
});

test('raising the own aircraft leaves map controls and panels above it', () => {
  for (const selector of ['.topbar', '.feed-banner', '.selection-card', '.map-tools', '.filter-bar']) {
    assert.ok(layer(selector) > layer('.map-marker.player'), `${selector} remains above player`);
  }
});

test('the raised player marker has no wide invisible click area or blocking decorative halo', () => {
  assert.match(css, /\.map-marker\.player \{[^}]*width: 1\.1875rem;[^}]*height: 1\.75rem;/);
  for (const pseudo of ['before', 'after']) {
    assert.ok(rules.some(([, selector, body]) => selector.trim() === `.map-marker.player::${pseudo}` && body.includes('pointer-events: none')));
  }
});
