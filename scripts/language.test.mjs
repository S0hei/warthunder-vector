import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { componentLoader } from './component-test-loader.mjs';
import { vectorDevBridge } from './vector-dev-bridge.mjs';

const load = componentLoader(), lang = load('lib/language.ts');
const ru = JSON.parse(readFileSync(new URL('../app/lib/translations/ru.json', import.meta.url), 'utf8'));
const auto = (language = 'ru', source = 'game') => ({ preference: 'auto', language, source });
const manual = language => ({ preference: language, language, source: 'manual' });
const payload = (state = auto(), automatic = auto()) => ({ ...state, automatic });
const reply = data => ({ ok: true, json: async () => data });
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

test('English and Russian aliases, browser fallback and manual choices are bounded and explicit', () => {
  for (const text of ['Russian', 'RU_ru', 'ru-RU', ' ru ']) assert.equal(lang.normalizeLanguage(text), 'ru');
  for (const text of ['English', 'en-GB', 'EN']) assert.equal(lang.normalizeLanguage(text), 'en');
  for (const text of [null, 1, 'rubbish', 'de-DE', 'english.exe', 'ru<script>', 'r'.repeat(65)]) assert.equal(lang.normalizeLanguage(text), null);
  same(lang.browserLanguage('auto', ['de-DE', 'ru-RU', 'en-US']), auto('ru', 'browser'));
  same(lang.browserLanguage('en', ['ru-RU']), manual('en'));
  same(lang.browserLanguage('auto', ['fr-FR']), auto('en', 'fallback'));
});

test('language payloads never accept inconsistent preferences, unknown enums or arbitrary fields', () => {
  for (const invalid of [null, [], 'ru', { ...manual('ru'), language: 'en' }, { ...auto(), source: 'manual' }, { ...manual('ru'), source: 'game' }, { ...auto(), language: 'fr' }]) assert.equal(lang.parseLanguageState(invalid), null);
  same(lang.parseLanguageState({ ...auto(), raw: 'ignored' }), auto());
  same(lang.parseAutomaticLanguage(payload(manual('en'))), auto());
  assert.equal(lang.parseAutomaticLanguage({ automatic: manual('ru') }), null);
});

test('Russian plurals, decimal separators and missing values retain the underlying meaning', () => {
  for (const [count, text] of [[0, '0 боёв'], [1, '1 бой'], [2, '2 боя'], [5, '5 боёв'], [11, '11 боёв'], [21, '21 бой'], [22, '22 боя'], [111, '111 боёв']]) assert.equal(lang.localizedCount('ru', count, 'battle'), text);
  assert.equal(lang.localizedNumber('ru', 1234.5, 1), '1\u00a0234,5');
  assert.equal(lang.localizedNumber('en', 1234.5, 1), '1,234.5');
  assert.equal(lang.localizedNumber('ru', null), 'Нет данных');
  assert.equal(lang.localizedNumber('ru', 0), '0');
  assert.equal(lang.localizedCount('en', 1, 'kill'), '1 kill');
});

test('combat terminology uses frags, deaths and spawns with correct Russian count forms', () => {
  const forms = { kill: ['фраг', 'фрага', 'фрагов'], death: ['смерть', 'смерти', 'смертей'], spawn: ['спавн', 'спавна', 'спавнов'] };
  for (const [key, words] of Object.entries(forms)) {
    for (const [count, form] of [[0, 2], [1, 0], [2, 1], [5, 2], [11, 2], [12, 2], [21, 0], [22, 1], [25, 2], [111, 2]]) {
      assert.equal(lang.localizedCount('ru', count, key), `${count} ${words[form]}`);
    }
    assert.equal(lang.localizedCount('ru', null, key), `Нет данных ${words[2]}`);
  }
  for (const key of ['Kills', 'AI kills', 'AI kills: air / ground / sea', 'Air / ground / sea kills']) assert.match(lang.translate('ru', key), /^Фраги/);
  assert.equal(lang.translate('ru', 'Destroyed'), 'Фраг');
  assert.equal(lang.translate('ru', 'Spawn point'), 'Точка спавна');
  assert.equal(lang.translate('ru', 'Game connection lost'), 'Связь с игрой потеряна');
});

test('every translation preserves placeholders, avoids long dashes and is inert text', () => {
  const placeholders = text => [...text.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(m => m[1]).sort();
  assert.ok(Object.keys(ru).length > 300);
  for (const [key, value] of Object.entries(ru)) {
    assert.ok(value.trim(), key); assert.deepEqual(placeholders(value), placeholders(key), key);
    assert.doesNotMatch(value, /[\u2012-\u2015]|<\/?(?:script|img)\b/);
  }
  assert.equal(lang.translate('ru', 'Team ping {grid}: {message}', { grid: 'B4', message: '<script>{grid}</script>' }), 'Отметка команды B4: <script>{grid}</script>');
  for (const key of ['constructor', '__proto__', 'Unknown Game Message']) assert.equal(lang.translate('ru', key), key);
});

test('all literal interface translations and country tooltips have Russian entries', () => {
  for (const name of readdirSync(new URL('../app/', import.meta.url)).filter(name => name.endsWith('.tsx'))) {
    const source = ts.createSourceFile(name, readFileSync(new URL('../app/' + name, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) assert.ok(Object.hasOwn(ru, node.arguments[0].text), name + ': ' + node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const catalog = JSON.parse(readFileSync(new URL('../app/lib/aircraft-catalog.json', import.meta.url), 'utf8'));
  for (const [country] of Object.values(catalog.countries)) assert.ok(Object.hasOwn(ru, country), country);
});

test('server rendering has a stable English default without browser globals', () => {
  const { LanguageProvider, LanguageSelector } = load('language-provider.tsx');
  const html = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(LanguageSelector)));
  assert.match(html, /aria-label="Language"/); assert.match(html, /Русский/); assert.match(html, /value="auto" selected/);
});

test('Russian Results, overview and Activity render translated labels while preserving names and statistics', () => {
  const t = (text, values) => lang.translate('ru', text, values);
  const bindings = { language: 'ru', t, locale: 'ru-RU', notAvailable: t('N/A'),
    number: (n, digits) => lang.localizedNumber('ru', n, digits), countLabel: (n, singular, plural) => lang.localizedCount('ru', n, singular, plural) };
  const localized = componentLoader({ './language-provider': { useTranslation: () => bindings } });
  const playedAt = new Date().toISOString();
  const battle = { schemaVersion: 1, id: 'abcdefab', accountId: '42', player: 'Pilot', playedAt,
    mission: 'avg_egypt_sinai', outcome: 'unknown', conflict: false, hasLog: true, hasReplay: true, rewardsFinal: false,
    wp: 1234, exp: 50, kills: 1, groundKills: 0, navalKills: 0, aiKills: 0, aiGroundKills: 0, aiNavalKills: 0,
    assists: 0, deaths: 1, spawns: 1, score: 0, seconds: null, vehicles: ['g_55s'] };
  const archive = { connection: 'connected', status: 'ready', paused: false, startedAt: new Date(Date.parse(playedAt) - 60000).toISOString(), unreadable: 0, rejected: 0, battles: [battle] };
  const original = JSON.stringify(archive);
  const props = { archive, account: '42', accounts: [['42', 'Pilot']], onAccountChange() {}, onHistory() {}, telemetryOnline: true };
  for (const file of ['file-battles-panel.tsx', 'session-overview.tsx']) {
    const html = renderToStaticMarkup(React.createElement(localized(file).default, props));
    for (const text of ['Нет результата', 'Фраги', 'Смерти', 'Спавны', 'Фраги / Смерти', 'Фраги / Спавны', 'Опыт', 'G.55S', 'Королевство Италия']) assert.ok(html.includes(text), file + ': ' + text);
    assert.doesNotMatch(html, /Уничтожено|Уничт\.|Потери|Возрождения|Возр\./);
    assert.doesNotMatch(html, /Airfield repairs included|С учётом ремонта/);
    assert.doesNotMatch(html, />Battle earnings<|>Experience<|>Kills<|>No result</);
    assert.doesNotMatch(html, /Статистика профиля|Подключить Chrome|Проверьте сайт|profile-summary|profile-settings/);
  }
  assert.equal(JSON.stringify(archive), original);
  const participants = [{ name: '<Enemy>{name}', vehicle: 'g_55s', team: 'enemy', observedAt: Date.parse(playedAt),
    lastDamage: { action: 'critical_damage', observedAt: Date.parse(playedAt) } }];
  const enemies = renderToStaticMarkup(React.createElement(localized('enemy-participants.tsx').default, { participants, status: 'live', search: '', selectedName: null }));
  assert.match(enemies, /Известные противники/); assert.match(enemies, /Критический/); assert.match(enemies, /&lt;Enemy&gt;\{name\}/);
  const activity = renderToStaticMarkup(React.createElement(localized('combat-activity-panel.tsx').default,
    { activity: { status: 'live', startedAt: Date.parse(playedAt), recent: [], participants, eventCount: 2 } }));
  assert.match(activity, /2 события/); assert.match(activity, /Участники/); assert.match(activity, /Боевых событий пока нет/);
});

// Exercise the actual provider's effects and event handlers without a browser,
// native process, real timers, filesystem writes, or network requests.
function harness({ boot, stored, endpoint = true, read = async () => reply(payload()), write = async preference => reply(payload(manual(preference))) } = {}) {
  const cells = [], effects = [], timers = new Map(), events = new Map(), calls = [], storage = new Map(stored ? [['vector-language', stored]] : []);
  let cursor = 0, dirty = true, tree, timerId = 0;
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hookedReact = { ...React,
    useState(initial) { const i = cursor++; if (!(i in cells)) cells[i] = typeof initial === 'function' ? initial() : initial;
      return [cells[i], value => { cells[i] = typeof value === 'function' ? value(cells[i]) : value; dirty = true; }]; },
    useRef(initial) { const i = cursor++; return cells[i] ??= { current: initial }; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || !equal(cells[i].deps, deps)) cells[i] = { deps, value: fn() }; return cells[i].value; },
    useCallback(fn, deps) { return hookedReact.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || !equal(cells[i].deps, deps)) { const old = cells[i]; cells[i] = { deps }; effects.push(() => { old?.cleanup?.(); cells[i].cleanup = fn(); }); } },
  };
  const window = { __VECTOR__: boot ? { language: boot } : undefined, addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) };
  const document = { documentElement: { lang: 'en' } };
  const localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const globals = { window, document, localStorage, navigator: { languages: ['en-US'] }, AbortController,
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { calls.push({ url, ...options }); return options.method === 'PUT' ? write(JSON.parse(options.body).preference) : read(); },
  };
  const Provider = componentLoader({ react: hookedReact, './lib/vector-bridge': { vectorEndpoint: () => endpoint ? { url: '/api/language', headers: { 'X-Vector-Token': 'fixture' } } : null } }, globals)('language-provider.tsx').LanguageProvider;
  const child = React.createElement('div', { id: 'persistent-map' });
  function render() { cursor = 0; dirty = false; tree = Provider({ children: child }); while (effects.length) effects.shift()(); }
  return { calls, storage, document, localStorage, window,
    state: () => tree.props.value,
    async flush() { for (let i = 0; i < 12; i++) { if (dirty) render(); await Promise.resolve(); } assert.equal(tree.props.children, child); },
    fire(ms) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); } },
    storageEvent(value) { events.get('storage')?.({ key: 'vector-language', newValue: value }); },
    close() { for (const cell of cells) cell?.cleanup?.(); },
  };
}

test('native boot wins over browser preference, changes save once and document language follows', async () => {
  let complete;
  const h = harness({ boot: auto(), stored: 'en', write: () => new Promise(resolve => { complete = resolve; }) });
  await h.flush(); assert.equal(h.state().language, 'ru'); assert.equal(h.document.documentElement.lang, 'ru');
  h.state().setPreference('en'); h.state().setPreference('ru'); await h.flush();
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 1); assert.equal(h.state().saving, true);
  complete(reply(payload(manual('en')))); await h.flush();
  assert.equal(h.state().language, 'en'); assert.equal(h.state().saving, false); assert.equal(h.document.documentElement.lang, 'en');
  const request = h.calls.find(c => c.method === 'PUT');
  assert.equal(request.body, '{"preference":"en"}'); assert.equal(request.headers['X-Vector-Token'], 'fixture');
  assert.equal(h.storage.get('vector-language'), 'en'); h.close();
});

test('a stale background read cannot overwrite a newer manual choice', async () => {
  let complete;
  const h = harness({ boot: auto(), read: () => new Promise(resolve => { complete = resolve; }) });
  await h.flush(); h.state().setPreference('en'); await h.flush();
  complete(reply(payload())); await h.flush(); assert.equal(h.state().language, 'en'); h.close();
});

test('failed native saves keep the current language, expose the error and allow retry', async () => {
  const h = harness({ boot: auto(), write: async () => ({ ok: false }) });
  await h.flush(); h.state().setPreference('en'); await h.flush();
  assert.equal(h.state().language, 'ru'); assert.equal(h.state().error, true); assert.equal(h.state().saving, false); h.close();
});

test('preview Auto follows detected game language independently from the native manual setting', async () => {
  let automatic = auto();
  const h = harness({ read: async () => reply(payload(manual('en'), automatic)) });
  await h.flush(); assert.equal(h.state().preference, 'auto'); assert.equal(h.state().language, 'ru');
  h.state().setPreference('en'); await h.flush(); assert.equal(h.storage.get('vector-language'), 'en');
  h.fire(60000); await h.flush(); assert.equal(h.state().language, 'en');
  h.state().setPreference('auto'); await h.flush(); assert.equal(h.state().language, 'ru');
  automatic = auto('en', 'system'); h.fire(60000); await h.flush(); assert.equal(h.state().source, 'system');
  h.storageEvent('ru'); await h.flush(); assert.equal(h.state().source, 'manual');
  assert.equal(h.calls.filter(c => c.method === 'PUT').length, 0); h.close();
});

test('standalone browser preferences work offline and storage failures are visible', async () => {
  const h = harness({ stored: 'ru', endpoint: false }); await h.flush(); assert.equal(h.state().language, 'ru');
  h.localStorage.setItem = () => { throw new Error('Blocked'); };
  h.state().setPreference('en'); await h.flush(); assert.equal(h.state().language, 'en'); assert.equal(h.state().error, true);
  assert.equal(h.calls.length, 0); h.close();
});

test('preview bridge accepts extended version/language bootstrap but only proxies read-only language', async () => {
  let middleware;
  vectorDevBridge().configureServer({ middlewares: { use: fn => { middleware = fn; } } });
  const original = globalThis.fetch, token = 'a'.repeat(64); let calls;
  try {
    for (const suffix of ['}', ",version:'0.3.0',language:{preference:'auto'}}"]) {
      calls = [];
      globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, text: async () => calls.length === 1
        ? `window.__VECTOR__={origin:'http://127.0.0.1:8112',token:'${token}'${suffix};` : JSON.stringify(payload()) }; };
      const res = { setHeader() {}, end(body) { this.body = body; } };
      await middleware({ url: '/api/vector/language', method: 'GET', headers: { host: 'localhost:3000' } }, res, () => assert.fail('route missing'));
      assert.equal(res.statusCode, 200); assert.equal(calls[1].url, 'http://127.0.0.1:8112/api/language');
      assert.equal(calls[1].options.headers['X-Vector-Token'], token); assert.ok(!res.body.includes(token));
    }
    calls = []; const res = { setHeader() {}, end() {} };
    await middleware({ url: '/api/vector/language', method: 'PUT', headers: { host: 'localhost:3000' } }, res, () => {});
    assert.equal(res.statusCode, 403); assert.equal(calls.length, 0);
  } finally { globalThis.fetch = original; }
});
