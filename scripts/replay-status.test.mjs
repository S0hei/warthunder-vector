import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { componentLoader } from './component-test-loader.mjs';

const language = componentLoader()('lib/language.ts');
const status = { schemaVersion: 1, status: 'ready', paused: false, startedAt: '2026-09-17T10:00:00Z', unreadable: 0, battles: [] };

async function poll(payload) {
  let effect, state;
  const load = componentLoader({
    react: { useState: initial => { state = initial; return [state, next => { state = typeof next === 'function' ? next(state) : next; }]; }, useEffect: callback => { effect = callback; } },
    './lib/vector-bridge': { vectorEndpoint: () => ({ url: '/api/battles', headers: {} }) },
  }, { AbortController, setTimeout: () => 1, clearTimeout() {},
    fetch: async () => ({ ok: true, status: 200, json: async () => payload, headers: { get: () => null } }) });
  load('use-file-archive.ts').useFileArchive();
  const stop = effect(); await new Promise(setImmediate); stop();
  return state;
}

test('replay skips are optional for older collectors and separate from unreadable saved records', async () => {
  assert.equal((await poll(status)).skippedReplays, 0);
  for (const count of [0, 1, 200]) {
    const archive = await poll({ ...status, skippedReplays: count });
    assert.equal(archive.connection, 'connected'); assert.equal(archive.status, 'ready');
    assert.equal(archive.skippedReplays, count); assert.equal(archive.unreadable, 0);
  }
  const archive = await poll({ ...status, status: 'read-error', skippedReplays: 2, unreadable: 1 });
  assert.equal(archive.status, 'read-error'); assert.equal(archive.unreadable, 1);
});

test('malformed replay skip counts cannot enter the UI', async () => {
  for (const skippedReplays of [-1, 201, 1.5, NaN, '2', null, {}]) {
    assert.equal((await poll({ ...status, skippedReplays })).connection, 'offline');
  }
});

test('English and Russian replay notices are quiet, count-specific and absent when nothing was skipped', () => {
  for (const locale of ['en', 'ru']) {
    const load = componentLoader({ './language-provider': { useTranslation: () => ({
      t: (key, values) => language.translate(locale, key, values), number: value => language.localizedNumber(locale, value),
    }) } });
    const Notice = load('replay-import-notice.tsx').default;
    for (const count of [0, undefined]) assert.equal(renderToStaticMarkup(React.createElement(Notice, { count })), '');
    const html = renderToStaticMarkup(React.createElement(Notice, { count: 2 }));
    assert.match(html, /class="results-message" role="status"/);
    assert.ok(html.includes(locale === 'ru' ? 'Результаты повторов недоступны: 2' : 'Replay results unavailable: 2'));
    assert.doesNotMatch(html, /role="alert"|folder access|свободное место/);
  }
});

test('Results and session show format notices without claiming a disk failure', () => {
  const load = componentLoader();
  for (const file of ['file-battles-panel.tsx', 'session-overview.tsx']) {
    const Component = load(file).default;
    const html = renderToStaticMarkup(React.createElement(Component, { archive: { ...status, connection: 'connected', rejected: 0, skippedReplays: 2 },
      account: undefined, accounts: [], onAccountChange() {}, onHistory() {}, telemetryOnline: true }));
    assert.match(html, /Replay results unavailable: 2/);
    assert.doesNotMatch(html, /Some files unavailable|Some game files could not be read|Could not load/);
  }
});
