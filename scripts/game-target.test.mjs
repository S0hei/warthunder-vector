import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isGameSelectedTarget } from '../app/lib/game-target.ts';

const contact = (icon = 'Fighter', overrides = {}) => ({
  type: 'aircraft', icon, icon_bg: `${icon}Target`, x: .4, y: .3, ...overrides,
});

test('live observed FighterTarget, WheeledTarget and AirdefenceTarget flag the selected vehicle', () => {
  assert.equal(isGameSelectedTarget(contact('Fighter', { blink: 0 }), true), true);
  for (const icon of ['Wheeled', 'Airdefence']) {
    assert.equal(isGameSelectedTarget(contact(icon, { type: 'ground_model', blink: 1 }), true), true);
  }
});

test('matching role target flags work independently of allegiance and heading', () => {
  for (const icon of ['Fighter', 'Assault', 'Bomber']) {
    for (const color of ['#174DFF', '#fa0C00', '#39D921']) {
      assert.equal(isGameSelectedTarget(contact(icon, { color, dx: -.5, dy: .5 }), true), true);
    }
  }
});

test('a blinking enemy without a target flag is not selected', () => {
  for (const blink of [0, 1, 2]) {
    assert.equal(isGameSelectedTarget(contact('Wheeled', {
      type: 'ground_model', color: '#f00C00', blink, icon_bg: 'none',
    }), true), false);
  }
});

test('missing, partial, mismatched and malformed flags do not imply selection', () => {
  for (const icon_bg of [undefined, null, 1, {}, '', 'none', 'Target', 'targeted', 'BomberTarget', 'FighterTargetExtra']) {
    assert.equal(isGameSelectedTarget(contact('Fighter', { icon_bg }), true), false);
  }
  for (const icon of ['', 'none', 'Player', null, undefined, 3]) {
    assert.equal(isGameSelectedTarget(contact('Fighter', { icon, icon_bg: `${icon}Target` }), true), false);
  }
  assert.equal(isGameSelectedTarget(null, true), false);
  assert.equal(isGameSelectedTarget(undefined, true), false);
});

test('target flags tolerate case and whitespace without fuzzy matching', () => {
  assert.equal(isGameSelectedTarget(contact(' FIGHTER ', { icon_bg: ' fighterTARGET ' }), true), true);
});

test('non-vehicles and invalid positions cannot produce a target marker', () => {
  for (const type of ['airfield', 'respawn_base_fighter', 'bombing_point', 'capture_zone', undefined]) {
    assert.equal(isGameSelectedTarget(contact('Fighter', { type }), true), false);
  }
  for (const value of [undefined, null, NaN, Infinity, '.4']) {
    assert.equal(isGameSelectedTarget(contact('Fighter', { x: value }), true), false);
    assert.equal(isGameSelectedTarget(contact('Fighter', { y: value }), true), false);
  }
  // The game can report valid coordinates outside the map image.
  assert.equal(isGameSelectedTarget(contact('Fighter', { x: -.1, y: 1.2 }), true), true);
});

test('target selection follows each snapshot, not array order or last selected contact', () => {
  const fighter = contact();
  const ground = contact('Airdefence', { type: 'ground_model', icon_bg: 'none' });
  const selected = (objects) => objects.filter((object) => isGameSelectedTarget(object, true)).map((object) => object.icon);
  assert.deepEqual(selected([fighter, ground]), ['Fighter']);
  assert.deepEqual(selected([{ ...ground, icon_bg: 'AirdefenceTarget' }, { ...fighter, icon_bg: 'none' }]), ['Airdefence']);
  assert.deepEqual(selected([ground, { ...fighter, icon_bg: 'none' }]), []);
  assert.deepEqual(selected([]), []);
  assert.equal(fighter.icon_bg, 'FighterTarget');
});

test('stale snapshots lose their target highlight when the feed disconnects', () => {
  assert.equal(isGameSelectedTarget(contact(), false), false);
  assert.equal(isGameSelectedTarget(contact(), true), true);
});

test('only live markers get game targeting, separately from manual selection and memory', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const liveStart = page.indexOf('{objects.map((object, index) =>');
  const memoryStart = page.indexOf('{showMemory && enemyTracks.filter');
  const memoryEnd = page.indexOf('{teamCues.map', memoryStart);
  const live = page.slice(liveStart, memoryStart);
  const memory = page.slice(memoryStart, memoryEnd);
  assert.match(live, /isGameSelectedTarget\(object, connected\)/);
  assert.match(live, /if \(!filters\[groupFor\(object\)\]\) return null/);
  assert.match(live, /gameTarget && <TargetReticle/);
  assert.match(live, /selectedIndex === index \? 'selected'/);
  assert.match(live, /Selected in game/);
  assert.doesNotMatch(memory, /gameTarget|TargetReticle|isGameSelectedTarget/);
});

test('target split ring is slim, scalable, transparent, steady and does not block map clicks', () => {
  const reticle = readFileSync(new URL('../app/target-reticle.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(reticle, /fill="none"/);
  assert.match(reticle, /aria-hidden="true"/);
  assert.match(reticle, /stroke="currentColor"/);
  assert.match(reticle, /strokeWidth="1" strokeLinecap="round"/);
  assert.match(reticle, /A10 10/);
  assert.match(css, /\.map-marker\.game-target \{[^}]*animation: none/);
  assert.match(css, /--target-outline: rgba\(233, 237, 222, \.68\)/);
  assert.match(css, /\.game-target-reticle \{[^}]*width: 1\.875rem;[^}]*height: 1\.875rem;[^}]*background: transparent;[^}]*pointer-events: none/s);
});
