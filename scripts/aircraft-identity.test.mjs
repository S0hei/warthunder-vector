import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { resolveAircraft } from '../app/lib/aircraft.ts';
import catalog from '../app/lib/aircraft-catalog.json' with { type: 'json' };
import { englishEntries, displayName, compileAircraft, compactFlag } from './aircraft-catalog.mjs';
import { componentLoader } from './component-test-loader.mjs';

test('archived aircraft IDs resolve to game display names with country flags', () => {
  const examples = {
    g_55s: ['G.55S', 'Kingdom of Italy'],
    'yak-3u': ['Yak-3U', 'USSR'],
    'bf-109f-4_trop': ['Bf 109 F-4/trop', 'Germany'],
    a7m1: ['A7M1 Reppu (NK9H)', 'Japan'],
    'p-38j': ['P-38J-15 Lightning', 'United States'],
    spitfire_fr_mk14e_belgium: ['Spitfire FR Mk XIVe', 'Belgium'],
    seafire_mk3_france: ['Seafire LF Mk.III', 'France'],
  };
  for (const [id, [name, country]] of Object.entries(examples)) {
    const resolved = resolveAircraft(id);
    assert.equal(resolved.name, name); assert.equal(resolved.countries[0].name, country);
    assert.equal(resolved.known, true); assert.match(resolved.countries[0].flag, /^data:image\/svg\+xml;base64,/);
  }
  for (const id of ['bf-109k-4', 'il-2m', 'mosquito_fb_mk6', 'p-51_mk1a_usaaf', 'sm_91', 'spitfire_mk5c', 'vb_10c1']) {
    assert.equal(resolveAircraft(id).known, true); assert(resolveAircraft(id).countries.length > 0);
  }
});

test('exact IDs tolerate case and whitespace but unknown IDs never receive a guessed nation', () => {
  assert.deepEqual(resolveAircraft(' G_55S '), resolveAircraft('g_55s'));
  assert.deepEqual(resolveAircraft('unknown_fighter_9000'), { name: 'Unknown Fighter 9000', countries: [], known: false });
  for (const name of ['Yak-unknown-export', '__proto__', 'constructor', 'Bf 109', 'Як-3У']) {
    assert.equal(resolveAircraft(name).known, false); assert.deepEqual(resolveAircraft(name).countries, []);
  }
  assert.equal(resolveAircraft('Як-3У').name, 'Як-3У');
  assert.equal(resolveAircraft('').name, 'Unknown aircraft');
});

test('the complete offline catalog has a flag asset for every supplied country', () => {
  assert(Object.keys(catalog.aircraft).length > 1500);
  for (const [id, [name, countries]] of Object.entries(catalog.aircraft)) {
    assert(name.trim()); assert(!name.includes('_'), id);
    assert.match(name, /^[\p{L}\p{N}]/u);
    for (const country of countries) assert(catalog.countries[country], `${id}: ${country}`);
  }
  for (const [name, flag] of Object.values(catalog.countries)) {
    assert(name); assert.match(flag, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(flag.split(',')[1], 'base64').toString('utf8');
    assert.match(svg, /^<svg\b/); assert.equal(compactFlag(svg), flag);
  }
});

test('localization parser preserves punctuation, escaped quotes and multiline fields', () => {
  const entries = englishEntries('"a_0";"Fighter ""Ace""";"ignored"\r\n"b_0";"Long\nName";"x;y"\n');
  assert.equal(entries.get('a_0'), 'Fighter "Ace"'); assert.equal(entries.get('b_0'), 'Long\nName');
  assert.equal(displayName('▄Spitfire\u00a0FR Mk XIVe'), 'Spitfire FR Mk XIVe');
  assert.throws(() => englishEntries('"a";"unclosed'));
});

test('country resolution honors operator overrides, multiple operators and explicit unknowns', () => {
  const tags = { a: { type: 'aircraft', operatorCountry: 'country_belgium', tags: { country_france: true } },
    b: { type: 'helicopter', operatorCountry: ['country_usa', 'country_greece_modern'] },
    c: { type: 'aircraft', tags: { country_ussr: true } },
    d: { type: 'aircraft', operatorCountry: 'country_invisible', tags: { country_usa: true } },
    e: { type: 'aircraft', tags: { country_usa: true, country_britain: true } }, f: { type: 'tank' } };
  const names = new Map(Object.keys(tags).map(id => [`${id}_0`, id.toUpperCase()]));
  const result = compileAircraft(tags, names);
  assert.deepEqual(result.a[1], ['country_belgium']);
  assert.deepEqual(result.b[1], ['country_usa', 'country_greece_modern']);
  assert.deepEqual(result.c[1], ['country_ussr']); assert.deepEqual(result.d[1], []); assert.deepEqual(result.e[1], []);
  assert.equal(result.f, undefined);
});

test('flag importing rejects active or externally loaded SVG content', () => {
  for (const payload of ['<svg><script>alert(1)</script></svg>', '<svg onload="x()"/>', '<svg><image href="https://example.com"/></svg>', '<svg><use href="https://example.com/a.svg#x"/></svg>']) assert.throws(() => compactFlag(payload));
});

// Render the actual leaf components without a browser or modifying the app's JSX pipeline.
function component(file, imports = {}) {
  const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const require = createRequire(import.meta.url);
  runInNewContext(outputText, { exports, require: id => imports[id] ?? require(id) });
  return exports.default;
}

test('aircraft rendering pairs each plane with its own flag and escapes unknown text', () => {
  const AircraftNames = component('aircraft-name.tsx', { './lib/aircraft': { resolveAircraft }, './language-provider': componentLoader()('language-provider.tsx') });
  const html = renderToStaticMarkup(createElement(AircraftNames, { vehicles: ['g_55s', 'spitfire_fr_mk14e_belgium', 'g_55s'] }));
  assert.equal((html.match(/class="aircraft-identity"/g) ?? []).length, 2);
  assert.match(html, /alt="Kingdom of Italy"/); assert.match(html, /alt="Belgium"/);
  assert.match(html, /G\.55S/); assert.match(html, /Spitfire FR Mk XIVe/);
  assert.doesNotMatch(html, /spitfire_fr_mk14e_belgium|g_55s|src="https?:/);
  const unknown = renderToStaticMarkup(createElement(AircraftNames, { vehicles: ['<script>alert(1)</script>'] }));
  assert.doesNotMatch(unknown, /<script|<img/); assert.match(unknown, /&lt;/);
});

test('reward labels are plain language without changing source semantics or finalization', async () => {
  const { componentLoader } = await import('./component-test-loader.mjs');
  const RewardLabel = componentLoader()('reward-label.tsx').default;
  assert.match(renderToStaticMarkup(createElement(RewardLabel, { kind: 'wp' })), />Battle earnings</);
  assert.match(renderToStaticMarkup(createElement(RewardLabel, { kind: 'exp' })), />Experience</);
  assert.match(renderToStaticMarkup(createElement(RewardLabel, { kind: 'wp' })), /may differ from your net Silver Lions after costs/);
  for (const file of ['file-battles-panel.tsx', 'session-overview.tsx']) {
    const source = readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8');
    assert.match(source, /<AircraftNames vehicles=\{b\.vehicles\}/);
    assert.match(source, /<RewardLabel kind="wp"/); assert.match(source, /<RewardLabel kind="exp"/);
    assert.doesNotMatch(source, /Logged WP|Logged EXP|WP \/ EXP/);
    assert.match(source, /rewardsFinal/);
  }
});
