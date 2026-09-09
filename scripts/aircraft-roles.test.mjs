import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AIRCRAFT_MARKS, aircraftRole, aircraftRoleLabel, aircraftViewBox } from '../app/lib/aircraft-roles.ts';

test('live map icon names distinguish fighter, assault and bomber', () => {
  for (const icon of ['Fighter', 'Assault', 'Bomber']) {
    assert.equal(aircraftRole({ type: 'aircraft', icon }), icon.toLowerCase());
  }
});
test('roles are identical for friendly, enemy and squad colors', () => {
  for (const color of ['#174DFF', '#fa0C00', '#f00C00', '#f20C00', '#39D921']) {
    for (const icon of ['Fighter', 'Assault', 'Bomber']) {
      assert.equal(aircraftRole({ type: 'aircraft', icon, color, blink: 1, icon_bg: 'none' }), icon.toLowerCase());
    }
  }
});
test('case and surrounding whitespace do not change a supplied role', () => {
  assert.equal(aircraftRole({ type: 'aircraft', icon: ' FIGHTER ' }), 'fighter');
  assert.equal(aircraftRole({ type: 'aircraft', icon: 'bOmBeR' }), 'bomber');
});
test('Player, missing and unfamiliar icons never imply fighter or human player', () => {
  for (const icon of ['Player', 'none', 'aircraft', 'fighter_bomber', 'bomber_spawn', '', null, undefined, 3]) {
    assert.equal(aircraftRole({ type: 'aircraft', icon, color: '#faC81E' }), 'unknown');
  }
  assert.equal(aircraftRole(null), 'unknown');
  assert.equal(aircraftRole(undefined), 'unknown');
});
test('spawn points and ground units cannot be reclassified as aircraft', () => {
  for (const type of ['respawn_base_bomber', 'respawn_base_fighter', 'ground_model', 'airfield']) {
    assert.equal(aircraftRole({ type, icon: 'Bomber' }), 'unknown');
  }
});
test('each role has a distinct, color-independent marking', () => {
  assert.deepEqual(AIRCRAFT_MARKS.fighter.tailBars, []);
  assert.deepEqual(AIRCRAFT_MARKS.assault.tailBars, [16]);
  assert.deepEqual(AIRCRAFT_MARKS.bomber.tailBars, [16, 20]);
  assert.equal(AIRCRAFT_MARKS.unknown.filled, false);
  const shapes = Object.values(AIRCRAFT_MARKS).map((mark) => JSON.stringify([mark.filled, mark.tailBars]));
  assert.equal(new Set(shapes).size, 4);
});
test('role labels distinguish known classes from unavailable roles', () => {
  assert.equal(aircraftRoleLabel('assault'), 'Assault aircraft');
  assert.equal(aircraftRoleLabel('unknown'), 'Aircraft (role unknown)');
});
test('retained contact copies keep the last supplied role', () => {
  const sample = { type: 'aircraft', icon: 'Bomber', color: '#fa0C00', x: .3, y: .7 };
  const retained = structuredClone(sample);
  sample.icon = 'Fighter';
  assert.equal(aircraftRole(retained), 'bomber');
});
test('one scalable transparent symbol is reused for live and retained headings', () => {
  const symbol = readFileSync(new URL('../app/aircraft-symbol.tsx', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(symbol, /currentColor/);
  assert.match(symbol, /Number\.isFinite\(heading\)/);
  assert.match(symbol, /mark\.tailBars\.map/);
  assert.match(symbol, /viewBox=\{aircraftViewBox\(role\)\}/);
  assert.match(page, /<AircraftSymbol role=\{aircraftRole\(object\)\} heading=\{rotation\}/);
  assert.match(page, /<AircraftSymbol role=\{aircraftRole\(object\)\} heading=\{headingFromObject\(object\)\}/);
  assert.match(css, /\.aircraft-symbol \{[^}]*width: \.875rem;[^}]*height: 1\.375rem;[^}]*background: transparent/s);
});

test('each aircraft role centers its visible shape, including tail strokes, without resizing', () => {
  for (const [role, mark] of Object.entries(AIRCRAFT_MARKS)) {
    const [x, y, width, height] = aircraftViewBox(role).split(' ').map(Number);
    const top = .5;
    const bottom = Math.max(14.5, ...mark.tailBars.map((bar) => bar + .875));
    assert.equal(x + width / 2, 7, role);
    assert.equal(y + height / 2, (top + bottom) / 2, role);
    assert.equal(top - y, y + height - bottom, role);
    assert.equal(width, 14);
    assert.equal(height, 22);
    assert.ok(y <= top && y + height >= bottom);
  }
});

test('aircraft artwork and target center coincide at all headings, zoom levels and display scales', () => {
  for (const [role, mark] of Object.entries(AIRCRAFT_MARKS)) {
    const [vx, vy, vw, vh] = aircraftViewBox(role).split(' ').map(Number);
    const paintedCenter = { x: 7, y: (.5 + Math.max(14.5, ...mark.tailBars.map((bar) => bar + .875))) / 2 };
    for (const heading of [0, 30, 90, 135, 180, 225, 270, 359]) {
      for (const rootPx of [16, 24, 32]) {
        for (const zoom of [.25, 1, 3.5, 4]) {
          const width = .875 * rootPx;
          const height = 1.375 * rootPx;
          // SVG normalization, then rotation about its center. CSS anchors
          // that center at the button midpoint, identical to the reticle.
          const localX = (paintedCenter.x - vx) / vw * width - width / 2;
          const localY = (paintedCenter.y - vy) / vh * height - height / 2;
          const radians = heading * Math.PI / 180;
          const dx = (localX * Math.cos(radians) - localY * Math.sin(radians)) * zoom;
          const dy = (localX * Math.sin(radians) + localY * Math.cos(radians)) * zoom;
          assert.ok(Math.hypot(dx, dy) < 1e-9, `${role}, ${heading}°, ${rootPx}px, ${zoom}×`);
        }
      }
    }
  }
});

test('map aircraft bypass grid row sizing and share the reticle anchor without affecting table icons', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.map-marker > \.aircraft-symbol \{[^}]*position: absolute;[^}]*left: 50%;[^}]*top: 50%;[^}]*translate: -50% -50%;/s);
  assert.match(css, /\.game-target-reticle \{[^}]*left: 50%;[^}]*top: 50%;[^}]*transform: translate\(-50%, -50%\);/s);
  assert.match(css, /\.map-marker\.player \.aircraft-symbol \{ z-index: 2; \}/);
  assert.doesNotMatch(css, /^\.aircraft-symbol \{[^}]*position: absolute/ms);
});
