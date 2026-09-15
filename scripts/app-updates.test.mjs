import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { componentLoader } from './component-test-loader.mjs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const { needsAppReload, parseUpdateStatus } = componentLoader()('use-app-updates.ts');

test('native version and instance changes refresh the tab, outages and malformed data do not', () => {
  const boot = { version: '0.2.0', instance: 'a'.repeat(32) };
  assert.equal(needsAppReload(boot, boot), false);
  assert.equal(needsAppReload(boot, { ...boot, version: '0.3.0' }), true);
  assert.equal(needsAppReload(boot, { ...boot, instance: 'b'.repeat(32) }), true);
  for (const value of [null, {}, 'offline', { version: 'x', instance: 'b'.repeat(32) }, { version: '0.3.0', instance: 'invalid' }]) assert.equal(needsAppReload(boot, value), false);
  assert.equal(needsAppReload({}, boot), false);
});
test('launch and hourly checks are native and independent from history collection', () => {
  const source = read('native/Updates.cs'), app = read('native/Vector.cs');
  assert.match(source, /new Timer\(_ => Check\(false\), null, skipStartup \? 3600000 : 0, 3600000\)/);
  assert.match(source, /if \(!OutOfBattle\(\)\) \{ prompt.Blocked\(\); return; \}/);
  assert.match(source, /if \(stopped \|\| !OutOfBattle\(\)\) \{ prompt.Blocked\(\); return; \}/);
  assert.match(source, /if \(!prompt.TakeRestart\(\)\) return/);
  assert.match(app, /if \(updates.RestartRequested\)/);
  assert.match(app, /new AppUpdates\(skipUpdate\)/);
  assert.match(app, /Check for app updates/);
  assert.match(app, /UpdateInstaller\.AcknowledgeStartup\(args\)/);
  assert.match(read('app/use-app-updates.ts'), /boot\.origin !== location\.origin/);
  assert.doesNotMatch(read('app/use-app-updates.ts'), /github\.com/);
});

test('update payloads reject untrusted versions and states and discard unrelated fields', () => {
  const ready = { state: 'ready', version: '0.3.4', error: null };
  assert.equal(JSON.stringify(parseUpdateStatus({ ...ready, path: 'private' })), JSON.stringify(ready));
  for (const value of [null, {}, 'ready', { ...ready, version: null }, { ...ready, version: '<script>' }, { ...ready, version: '1'.repeat(100) }, { ...ready, state: 'install-anything' }, { ...ready, error: 'raw exception' }]) assert.equal(parseUpdateStatus(value), null);
});

test('the popup renders localized ready, restart, unsafe-battle and rollback states', () => {
  const language = componentLoader()('lib/language.ts');
  for (const locale of ['en', 'ru']) {
    const Component = componentLoader({ './language-provider': { useTranslation: () => ({ t: (text, values) => language.translate(locale, text, values) }) } })('app-update-notice.tsx').default;
    const render = (update, props = {}) => renderToStaticMarkup(React.createElement(Component, { update, requesting: false, requestError: false, reconnectFailed: false, restart() {}, ...props }));
    const ready = { state: 'ready', version: '0.3.4', error: null };
    assert.equal(render(null), '');
    assert.equal(render({ state: 'idle', version: null, error: null }), '');
    const html = render(ready);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-labelledby=/);
    assert.ok(html.includes(language.translate(locale, 'Restart Vector')));
    assert.ok(html.includes(language.translate(locale, 'Later')));
    assert.doesNotMatch(html, /disabled=""|aria-modal="true"/);
    assert.match(render({ ...ready, state: 'restarting' }), /disabled=""/);
    assert.ok(render({ ...ready, error: 'battle-active' }).includes(language.translate(locale, 'Return to the hangar or close War Thunder, then try again.')));
    const failed = render({ ...ready, state: 'failed', error: 'rolled-back' });
    assert.ok(failed.includes(language.translate(locale, 'The new version could not start. Your current version was kept.')));
    assert.ok(!failed.includes(language.translate(locale, 'Restart Vector')));
    assert.ok(failed.includes(language.translate(locale, 'Close')));
    const disconnected = render({ ...ready, state: 'restarting' }, { reconnectFailed: true });
    assert.ok(disconnected.includes(language.translate(locale, 'Vector did not reconnect. Open Vector again.')));
    assert.doesNotMatch(disconnected, /disabled=""/);
  }
});

test('Later collapses the popup without restarting and the chip brings the action back', () => {
  let dismissed = '', restarts = 0;
  const Component = componentLoader({
    react: { ...React, useId: () => 'update-test', useState: () => [dismissed, value => { dismissed = value; }] },
    './language-provider': { useTranslation: () => ({ t: text => text }) },
  })('app-update-notice.tsx').default;
  const props = { update: { state: 'ready', version: '0.3.4', error: null }, requesting: false, requestError: false, restart: () => { restarts++; } };
  const actions = Component(props).props.children[2].props.children;
  actions[0].props.onClick();
  assert.equal(restarts, 0);
  const chip = Component(props);
  assert.equal(chip.props.className, 'app-update-chip');
  chip.props.onClick();
  Component(props).props.children[2].props.children[1].props.onClick();
  assert.equal(restarts, 1);
});

const readyUpdate = { state: 'ready', version: '0.3.5', error: null };
const nativeBoot = { origin: 'http://127.0.0.1:8112', token: 'a'.repeat(64), version: '0.3.4', instance: 'b'.repeat(32), updates: true };
const jsonReply = (value, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => value });
function updateHarness({ boot = nativeBoot, respond = url => jsonReply(url === '/api/version' ? nativeBoot : readyUpdate) } = {}) {
  const cells = [], effects = [], timers = new Map(), calls = [];
  let cursor = 0, dirty = true, value, timerId = 0, reloads = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = { ...React,
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], next => { cells[i] = next; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return cells[i] ??= { current: initial }; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || !equal(cells[i].deps, deps)) { const old = cells[i]; cells[i] = { deps }; effects.push(() => { old?.cleanup?.(); cells[i].cleanup = fn(); }); } },
  };
  const hook = componentLoader({ react }, {
    window: { __VECTOR__: boot }, location: { origin: nativeBoot.origin, reload() { reloads++; } }, AbortController,
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    fetch: async (url, options) => { calls.push({ url, ...options }); return respond(url, options); },
  })('use-app-updates.ts').useAppUpdates;
  return { calls, timers, state: () => value, reloads: () => reloads,
    async flush() { for (let i = 0; i < 20; i++) { if (dirty) { cursor = 0; dirty = false; value = hook(); while (effects.length) effects.shift()(); } await Promise.resolve(); } },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    close() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

test('download polling cannot restart Vector and standalone or foreign bootstrap cannot control it', async () => {
  for (const boot of [null, { ...nativeBoot, origin: 'https://unrelated.example' }]) {
    const h = updateHarness({ boot }); await h.flush(); await h.state().restart(); assert.equal(h.calls.length, 0); h.close();
  }
  const h = updateHarness(); await h.flush(); h.fire(3000); await h.flush();
  assert.equal(h.state().update.state, 'ready'); assert.equal(h.calls.filter(c => c.method === 'POST').length, 0);
  assert.ok(h.calls.filter(c => c.url === '/api/updates').every(c => c.headers['X-Vector-Token'] === nativeBoot.token));
  h.close(); assert.equal(h.timers.size, 0);
});

test('restart click posts once, blocks duplicate clicks and survives a stale background status', async () => {
  let completeRead, completePost, reads = 0;
  const h = updateHarness({ respond: (url, options) => {
    if (options.method === 'POST') return new Promise(resolve => { completePost = resolve; });
    if (url === '/api/version') return jsonReply(nativeBoot);
    if (++reads === 2) return new Promise(resolve => { completeRead = resolve; });
    return jsonReply(readyUpdate);
  } });
  await h.flush(); h.fire(3000); await h.flush();
  void h.state().restart(); void h.state().restart(); await h.flush();
  assert.equal(h.state().requesting, true); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  completePost(jsonReply({ ...readyUpdate, state: 'restarting' }, 202)); await h.flush();
  completeRead(jsonReply(readyUpdate)); await h.flush();
  assert.equal(h.state().update.state, 'restarting'); assert.equal(h.state().requesting, false);
  h.fire(90000); await h.flush(); assert.equal(h.state().reconnectFailed, true);
  h.close(); assert.equal(h.timers.size, 0);
});

test('an instance change reloads even after rollback to the same version', async () => {
  const h = updateHarness({ respond: () => jsonReply({ ...nativeBoot, instance: 'c'.repeat(32) }) });
  await h.flush(); assert.equal(h.reloads(), 1); assert.equal(h.calls.length, 1); assert.equal(h.timers.size, 0); h.close();
});

test('a rejected or interrupted restart is visible and can be retried without an automatic POST', async () => {
  const h = updateHarness({ respond: (url, options) => options.method === 'POST' ? jsonReply({}, 403) : jsonReply(url === '/api/version' ? nativeBoot : readyUpdate) });
  await h.flush(); await h.state().restart(); await h.flush();
  assert.equal(h.state().requestError, true); assert.equal(h.state().requesting, false);
  h.fire(3000); await h.flush(); assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  await h.state().restart(); assert.equal(h.calls.filter(c => c.method === 'POST').length, 2); h.close();
});

test('unmount aborts an in-flight restart and cancels reconnect timers', async () => {
  const h = updateHarness({ respond: (url, options) => options.method === 'POST'
    ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    : jsonReply(url === '/api/version' ? nativeBoot : readyUpdate) });
  await h.flush(); void h.state().restart(); await h.flush(); h.close(); await h.flush();
  assert.equal(h.calls.find(c => c.method === 'POST').signal.aborted, true); assert.equal(h.timers.size, 0);
});
test('release version, pinned workflow, draft verification and public source exclusions agree', () => {
  const pkg = JSON.parse(read('package.json')), workflow = read('.github/workflows/release.yml');
  assert.ok(read('native/Version.cs').includes(`Current = "${pkg.version}"`));
  for (const line of workflow.split('\n').filter(l => /uses:/.test(l))) assert.match(line, /@[a-f0-9]{40}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /node scripts\/publish-release\.mjs/);
  const publishing = read('scripts/publish-release.mjs');
  assert.match(publishing, /Published releases are never overwritten/);
  assert.match(publishing, /Uploaded asset verification failed/);
  assert.ok(publishing.indexOf('verifyAssets(release, files)') < publishing.indexOf("'PATCH', { draft: false"));
  assert.doesNotMatch(workflow, /pull_request_target|id_ed25519|PRIVATE KEY/);
  for (const path of ['/Vector-data/', '/outputs/', '/.vite/', '/Vector.html', '/Vector.exe']) assert.ok(read('.gitignore').includes(path));
});
