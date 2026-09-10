import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMapObjects, parseMapInfo, parseMission, parseGameChat, readJson, startPolling } from '../app/lib/telemetry.ts';
import { visibleEnemyTracks } from '../app/lib/enemy-memory.ts';
import { componentLoader } from './component-test-loader.mjs';
import { battleAccounts } from '../app/lib/file-battles.ts';

test('account picker uses the newest available nickname and preserves separate accounts', () => {
  assert.deepEqual(battleAccounts([
    { accountId: '2', player: 'New name' }, { accountId: '1', player: null },
    { accountId: '2', player: 'Old name' }, { accountId: '1', player: 'Known name' },
  ]), [['2', 'New name'], ['1', 'Known name']]);
});

test('malformed contacts are skipped without losing valid vehicles, airfields or out-of-map targets', () => {
  const valid = [{ type: 'aircraft', icon: 'Player', x: -.1, y: 1.2 }, { type: 'airfield', sx: 0, sy: 0, ex: .5, ey: .5 }];
  const invalid = [null, true, {}, { type: 12 }, { type: 'aircraft', icon: 42 }, { type: 'aircraft', color: [] },
    { type: 'aircraft', x: Infinity }, { type: 'ground_model', x: '.5' }];
  assert.deepEqual(parseMapObjects([...invalid, ...valid]), valid);
  for (const value of [null, {}, Array(10001).fill(null)]) assert.throws(() => parseMapObjects(value));
});

test('invalid map geometry never reaches grid calculations; hangar placeholders still clear the map', () => {
  for (const value of [null, [], { valid: true, grid_steps: [0, 1] }, { valid: true, grid_size: '1,2' },
    { valid: true, grid_steps: [Number.MIN_VALUE, 1] }, { valid: true, map_generation: '3' },
    { valid: true, map_min: [2, 0], map_max: [1, 1] }, { valid: true, map_min: [-1e308, 0], map_max: [1e308, 1] }]) {
    assert.throws(() => parseMapInfo(value));
  }
  assert.deepEqual(parseMapInfo({ valid: false, grid_size: [0, 0] }), { valid: false, map_generation: undefined });
  assert.equal(parseMapInfo({ valid: true, map_generation: 2, grid_steps: [1000, 1000] }).map_generation, 2);
});

test('null objectives and chat entries cannot crash rendering or corrupt the chat cursor', () => {
  assert.deepEqual(parseMission({ status: 'running', objectives: [null, { text: 2 }, { text: 'Defend' }] }),
    { status: 'running', objectives: [{ text: 'Defend' }] });
  assert.throws(() => parseMission({ objectives: {} }));
  assert.deepEqual(parseGameChat([null, { id: -1, msg: 'x' }, { id: 2, msg: null }, { id: 3, msg: 'x', time: NaN }, { id: 1, msg: '[A1]' }]), [{ id: 1, msg: '[A1]' }]);
});

test('polling keeps one timer, survives failures and cancels an in-flight request on disposal', async t => {
  let id = 0, calls = 0, signal;
  const timers = new Map();
  t.mock.method(globalThis, 'setTimeout', fn => { timers.set(++id, fn); return id; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const stop = startPolling(async next => { signal = next; if (++calls === 2) throw Error('Disconnected'); }, 100);
  await Promise.resolve();
  for (let i = 0; i < 1000; i++) {
    assert.equal(timers.size, 1);
    const [id, fn] = timers.entries().next().value; timers.delete(id); await fn();
  }
  stop(); assert.equal(signal.aborted, true); assert.equal(timers.size, 0);
  let complete;
  const pending = startPolling(next => { signal = next; return new Promise(resolve => { complete = resolve; }); }, 100);
  pending(); complete(); await Promise.resolve();
  assert.equal(signal.aborted, true); assert.equal(timers.size, 0);
});

test('telemetry requests time out and respect parent cancellation without leaking timers', async t => {
  const timers = new Set();
  t.mock.method(globalThis, 'setTimeout', fn => { timers.add(fn); return fn; });
  t.mock.method(globalThis, 'clearTimeout', fn => timers.delete(fn));
  t.mock.method(globalThis, 'fetch', (url, options) => {
    assert.match(url, /^http:\/\/127\.0\.0\.1:8111\//);
    assert.equal(options.credentials, 'omit');
    return new Promise((resolve, reject) => {
      const abort = () => reject(Error('Aborted'));
      if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    });
  });
  const parent = new AbortController();
  const first = readJson('/map_info.json', parent.signal); parent.abort(); await assert.rejects(first);
  assert.equal(timers.size, 0);
  const second = readJson('/map_obj.json'); for (const expire of timers) expire(); await assert.rejects(second);
  assert.equal(timers.size, 0);
});

test('stale enemy contacts become last-known positions and expire without another snapshot', () => {
  const original = [{ id: 1, lastSeen: 1000, active: true }];
  assert.equal(visibleEnemyTracks(original, 1000, 2000)[0].active, true);
  assert.equal(visibleEnemyTracks(original, 1000, 2800)[0].active, false);
  assert.deepEqual(visibleEnemyTracks(original, 1000, 91001), []);
  assert.equal(original[0].active, true);
});

// Small hook harness: no browser, real game or production data is involved.
function hookHarness(file, exportName, overrides = {}, globals = {}) {
  let cursor = 0, value, closed = false;
  const cells = [], effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [cells[index].value, next => { assert.equal(closed, false, 'No updates after cleanup'); cells[index].value = typeof next === 'function' ? next(cells[index].value) : next; }];
    },
    useEffect(effect, deps) {
      const index = cursor++, old = cells[index];
      if (!old || deps.some((v, i) => !Object.is(v, old.deps[i]))) {
        cells[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { cells[index].cleanup?.(); cells[index].cleanup = effect(); });
      }
    },
  };
  const hook = componentLoader({ react, ...overrides }, globals)(file)[exportName];
  return {
    render(props) { cursor = 0; value = hook(props); while (effects.length) effects.shift()(); return value; },
    close() { closed = true; for (const cell of cells) cell?.cleanup?.(); },
  };
}

test('map image retries use bounded backoff, stop after success and cancel on map changes', () => {
  const timers = new Map(); let id = 0;
  const harness = hookHarness('map-image.tsx', 'default', {}, {
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
  });
  const props = { source: 'http://127.0.0.1:8111/map.img?generation=2', alt: 'Map' };
  assert.equal(harness.render(props).props.src, props.source);
  for (let i = 0; i < 8; i++) {
    harness.render(props).props.onError(); harness.render(props);
    assert.equal(timers.size, 1);
    const [id, timer] = timers.entries().next().value; timers.delete(id);
    assert.equal(timer.ms, Math.min(30000, 1500 * 2 ** Math.min(i, 5)));
    timer.fn(); assert.match(harness.render(props).props.src, new RegExp(`&retry=${i + 1}$`));
  }
  harness.render(props).props.onLoad(); harness.render(props); assert.equal(timers.size, 0);
  harness.render(props).props.onError(); harness.render(props); harness.close(); assert.equal(timers.size, 0);
});

test('battle transitions discard old in-flight contacts, objectives and chat before resetting cursors', async () => {
  const loops = [], pending = [];
  const telemetry = { parseMapObjects, parseMapInfo, parseMission, parseGameChat,
    startPolling(task) { const controller = new AbortController(); loops.push({ run: () => task(controller.signal), controller }); return () => controller.abort(); },
    readJson(path, signal) { return new Promise(resolve => pending.push({ path, signal, resolve })); },
  };
  const h = hookHarness('use-war-thunder-feed.ts', 'useWarThunderFeed', { './lib/telemetry': telemetry });
  h.render();
  const finish = async (index, payload) => { const task = loops[index].run(); pending.at(-1).resolve(payload); await task; return h.render(); };
  await finish(1, { valid: true, map_generation: 1 });
  await finish(0, [{ type: 'aircraft', icon: 'Player', x: .3, y: .4 }]);
  await finish(3, [{ id: 90, msg: '[A1]' }, { id: 90, msg: 'Duplicate' }]);
  assert.equal(h.render().teamMessages.length, 1);
  const oldTasks = [loops[0].run(), loops[2].run(), loops[3].run()];
  const oldResponses = pending.slice(-3);
  assert.match(oldResponses[2].path, /lastId=90/);
  const state = await finish(1, { valid: true, map_generation: 2 });
  assert.equal(state.objects.length, 0); assert.equal(state.trail.length, 0);
  oldResponses[0].resolve([{ type: 'aircraft', icon: 'Player', x: .8, y: .9 }]);
  oldResponses[1].resolve({ status: 'running', objectives: [{ text: 'Old battle' }] });
  oldResponses[2].resolve([{ id: 100, msg: 'Old battle' }]);
  await Promise.all(oldTasks);
  assert.equal(h.render().objects.length, 0); assert.equal(h.render().teamMessages.length, 0);
  assert.equal(h.render().mission.status, undefined);
  const chat = loops[3].run(); assert.match(pending.at(-1).path, /lastId=0/); pending.at(-1).resolve([]); await chat;
  const revision = h.render().mapRevision;
  await finish(1, { valid: false, map_generation: 2 }); await finish(1, { valid: true, map_generation: 2 });
  assert.equal(h.render().mapRevision, revision + 2, 'Same-map sorties are separate sessions');
  const final = loops[0].run(); const response = pending.at(-1); h.close(); response.resolve([]); await final;
  assert.ok(loops.every(loop => loop.controller.signal.aborted));
});
