import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vectorDevBridge } from './vector-dev-bridge.mjs';

function middleware() {
  let handle;
  vectorDevBridge().configureServer({ middlewares: { use(fn) { handle = fn; } } });
  return handle;
}

test('retired profile routes are never forwarded to an old collector', async t => {
  t.mock.method(globalThis, 'fetch', () => assert.fail('No profile request should reach the collector'));
  const handle = middleware();
  for (const url of ['/api/vector/profile', '/api/vector/profile-connector', '/api/profile', '/downloads/vector-profile-connector.zip']) {
    for (const method of ['GET', 'PUT', 'POST', 'OPTIONS']) {
      let passed = false;
      await handle({ url, method, headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }, {}, () => { passed = true; });
      assert.equal(passed, true, `${method} ${url} has no collector integration`);
    }
  }
});

test('development bridge still reads local history, activity and language without exposing its token', async t => {
  const token = 'a'.repeat(64), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return { ok: true, text: async () => url === 'http://127.0.0.1:8112'
      ? `window.__VECTOR__={origin:'http://127.0.0.1:8112',token:'${token}'}`
      : '{"ok":true}' };
  });
  const handle = middleware();
  for (const route of ['battles', 'activity-teams', 'language']) {
    const res = { setHeader() {}, end(body) { this.body = body; } };
    await handle({ url: `/api/vector/${route}`, method: 'GET', headers: { host: 'localhost:3000' } }, res, () => assert.fail('Expected local route'));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, '{"ok":true}');
    assert.equal(calls.at(-1).url, `http://127.0.0.1:8112/api/${route}`);
    assert.equal(calls.at(-1).options.headers['X-Vector-Token'], token);
  }
});

test('active app and portable build have no profile reader, pairing or embedded browser wiring', () => {
  for (const file of ['native/Vector.cs', 'scripts/build-windows.ps1', 'scripts/test-windows.ps1',
    'app/file-battles-panel.tsx', 'app/lib/vector-bridge.ts', 'app/globals.css', 'app/lib/translations/ru.json']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /Profile(?:Store|Connector|Browser|Panel|Tests)|profile-snapshots|profile-summary|profile-connector|WebView2|webview2-sdk|pair-chrome/, file);
  }
});
