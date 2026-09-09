import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { airfieldBattleArea, fitMapArea, MIN_MAP_ZOOM, MAX_MAP_ZOOM } from '../app/lib/map-fit.ts';

const runway = (sx, sy, ex, ey, color) => ({ type: 'airfield', sx, sy, ex, ey, color });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const airfields = [runway(.2, .7, .25, .75, '#174DFF'), runway(.7, .15, .8, .2, '#fa0C00')];

function project(point, view, stage) {
  const size = Math.min(stage.width, stage.height);
  return { x: stage.width / 2 + (point.x - .5) * size * view.zoom + view.pan.x,
    y: stage.height / 2 + (point.y - .5) * size * view.zoom + view.pan.y };
}

test('battle area includes both runway ends for both teams and 10% offset', () => {
  const area = airfieldBattleArea(airfields);
  close(area.minX, .14); close(area.maxX, .86);
  close(area.minY, .09); close(area.maxY, .81);
});
test('all runways participate, not just the nearest pair or their centers', () => {
  const area = airfieldBattleArea([...airfields, runway(.1, .9, .15, .95, '#174DFF'), runway(.9, .05, .95, .1, '#fa0C00')]);
  assert.ok(area.minX < .1 && area.maxX > .95);
  assert.ok(area.minY < .05 && area.maxY > .95);
});
test('aircraft, spawn points and ground markers do not move the battle fit', () => {
  const baseline = airfieldBattleArea(airfields);
  for (const type of ['aircraft', 'respawn_base_bomber', 'respawn_base_fighter', 'ground_model', 'bombing_point']) {
    assert.deepEqual(airfieldBattleArea([...airfields, { type, x: 8, y: -2, sx: -2, sy: -2, ex: 8, ey: 8 }]), baseline);
  }
});
test('reversed runway endpoints have the same fit', () => {
  assert.deepEqual(airfieldBattleArea(airfields.map((r) => runway(r.ex, r.ey, r.sx, r.sy, r.color))), airfieldBattleArea(airfields));
});
test('parallel/point runways retain a minimum offset and bounded zoom', () => {
  const area = airfieldBattleArea([runway(.5, .5, .5, .5)]);
  close(area.minX, .475); close(area.maxX, .525);
  close(area.minY, .475); close(area.maxY, .525);
  assert.equal(fitMapArea(area, { width: 800, height: 800 }, 'battle').zoom, 3.5);
});
test('missing or malformed runway geometry is excluded without inventing endpoints', () => {
  assert.equal(airfieldBattleArea([]), null);
  for (const broken of [
    { type: 'airfield', x: .4, y: .6 }, { type: 'airfield', sx: .1, sy: .2, ex: .3 },
    runway(NaN, .1, .2, .3), runway(.1, Infinity, .2, .3), runway('.1', .2, .3, .4),
  ]) assert.deepEqual(airfieldBattleArea([...airfields, broken]), airfieldBattleArea(airfields));
});
test('no airfields falls back to whole-map overview', () => {
  assert.deepEqual(fitMapArea(null, { width: 1920, height: 1080 }, 'battle'), { zoom: 1, pan: { x: 0, y: 0 } });
});
test('runways at map borders still have padding and can fit below 1x zoom', () => {
  const area = airfieldBattleArea([runway(0, 0, .01, .01), runway(.99, .99, 1, 1)]);
  assert.ok(area.minX < 0 && area.maxX > 1);
  const view = fitMapArea(area, { width: 1000, height: 1000 }, 'battle');
  assert.ok(view.zoom < 1 && view.zoom >= MIN_MAP_ZOOM);
  close(view.zoom, .8);
  assert.equal(MAX_MAP_ZOOM, 4);
});
test('padded area and runways fit landscape, portrait, 4K and ultrawide viewports', () => {
  const area = airfieldBattleArea(airfields);
  for (const [width, height] of [[1408, 1080], [2816, 2160], [400, 900], [3440, 1000], [600, 340]]) {
    const stage = { width, height };
    const view = fitMapArea(area, stage, 'battle');
    const points = [
      { x: area.minX, y: area.minY }, { x: area.maxX, y: area.maxY },
      ...airfields.flatMap((r) => [{ x: r.sx, y: r.sy }, { x: r.ex, y: r.ey }]),
    ];
    for (const point of points) {
      const screen = project(point, view, stage);
      assert.ok(screen.x > 0 && screen.x < width && screen.y > 0 && screen.y < height);
    }
    const center = project({ x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 }, view, stage);
    close(center.x, width / 2); close(center.y, height / 2);
  }
});
test('new map/airfield geometry produces a new independent camera target', () => {
  const stage = { width: 1408, height: 1080 };
  const first = fitMapArea(airfieldBattleArea(airfields), stage, 'battle');
  const second = fitMapArea(airfieldBattleArea([runway(.05, .05, .06, .06), runway(.25, .2, .3, .25)]), stage, 'battle');
  assert.notDeepEqual(first, second);
});
test('viewport resizing recalculates the fit without mixing pixel coordinate spaces', () => {
  const area = airfieldBattleArea(airfields);
  const first = fitMapArea(area, { width: 1408, height: 1080 }, 'battle');
  const doubled = fitMapArea(area, { width: 2816, height: 2160 }, 'battle');
  close(first.zoom, doubled.zoom);
  close(first.pan.x * 2, doubled.pan.x); close(first.pan.y * 2, doubled.pan.y);
});
test('existing active-air fit keeps its padding, minimum span and zoom limits', () => {
  for (const area of [
    { minX: .2, maxX: .8, minY: .1, maxY: .9 },
    { minX: .6, maxX: .6, minY: .7, maxY: .7 },
    { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  ]) {
    const stage = { width: 1408, height: 1080 };
    const expected = Math.max(1, Math.min(3.5, Math.min(stage.width / (Math.max(area.maxX - area.minX, .22) * 1080),
      stage.height / (Math.max(area.maxY - area.minY, .22) * 1080)) * .82));
    close(fitMapArea(area, stage, 'air').zoom, expected);
  }
});
test('invalid viewport dimensions do not produce a camera update', () => {
  for (const [width, height] of [[0, 900], [100, 0], [-1, 100], [NaN, 10], [100, Infinity]]) {
    assert.equal(fitMapArea(airfieldBattleArea(airfields), { width, height }, 'battle'), null);
  }
});
test('invalid bounds never become NaN camera transforms', () => {
  const overview = { zoom: 1, pan: { x: 0, y: 0 } };
  assert.deepEqual(fitMapArea({ minX: NaN, maxX: 1, minY: 0, maxY: 1 }, { width: 900, height: 900 }, 'battle'), overview);
  assert.deepEqual(fitMapArea({ minX: 1, maxX: 0, minY: 0, maxY: 1 }, { width: 900, height: 900 }, 'battle'), overview);
});
test('modes have separate controls, and manual navigation suspends fitting', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /event\.key === '0'\) enableAutoFit\('air'\)/);
  assert.match(page, /event\.key\.toLowerCase\(\) === 'b'\) enableAutoFit\('battle'\)/);
  assert.match(page, /aria-pressed=\{autoFit === 'air'\}/);
  assert.match(page, /aria-pressed=\{autoFit === 'battle'\}/);
  assert.match(page, /const battleArea = useMemo\(\(\) => airfieldBattleArea\(objects\), \[objects\]\)/);
  for (const method of ['setZoomSafe', 'centerPlayer', 'focusPoint', 'onPointerDown']) {
    assert.match(page, new RegExp(`const ${method}[^]*?setAutoFit\\(null\\)`));
  }
});
