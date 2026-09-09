import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as copy from '../app/lib/ui-text.ts';
import * as battles from '../app/lib/file-battles.ts';
import * as session from '../app/lib/session-overview.ts';
import * as aircraft from '../app/lib/aircraft.ts';
import * as maps from '../app/lib/map-names.ts';
import * as combat from '../app/lib/combat-activity.ts';
import { componentLoader } from './component-test-loader.mjs';
const activitySearch = componentLoader()('lib/activity-search.ts');
const gameIcons = componentLoader()('game-icon.tsx');

test('missing values are explicit, actual zero stays zero, and counts agree with their nouns', () => {
  assert.equal(copy.formatNumber(null), 'N/A');
  assert.equal(copy.formatNumber(0), '0');
  assert.equal(copy.formatNumber(1.25, 2), (1.25).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  assert.equal(copy.countLabel(1, 'battle'), '1 battle');
  assert.equal(copy.countLabel(0, 'event'), '0 events');
  assert.equal(copy.countLabel(2, 'death'), '2 deaths');
});

test('plain-language outcomes never promise a later result or turn missing data into a defeat', () => {
  assert.equal(copy.battleOutcomeText({ outcome: 'win', conflict: false }), 'Victory');
  assert.equal(copy.battleOutcomeText({ outcome: 'loss', conflict: false }), 'Defeat');
  assert.equal(copy.battleOutcomeText({ outcome: 'unknown', conflict: false }), 'No result');
  assert.equal(copy.battleOutcomeText({ outcome: 'unknown', conflict: true }), 'Results disagree');
});

test('app-authored UI, metadata and tray text contain no long dashes', () => {
  const root = new URL('../app/', import.meta.url);
  for (const file of readdirSync(root, { recursive: true }).filter(f => /\.tsx?$/.test(f))) {
    const content = readFileSync(new URL(file.replaceAll('\\', '/'), root), 'utf8');
    const ast = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    function visit(node) {
      if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateTail || node.kind === ts.SyntaxKind.TemplateMiddle) {
        assert.doesNotMatch(node.text, /[\u2012-\u2015]|&(?:m|n)dash;/, `${file}: ${node.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  for (const file of ['build-src/index.html', 'native/Vector.cs']) {
    assert.doesNotMatch(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), /[\u2012-\u2015]/);
  }
});

// Render real components with React on the server; no browser or game interaction.
function ui(file, extra = '') {
  const imported = { './lib/ui-text': copy, './lib/file-battles': battles, './lib/session-overview': session, './lib/aircraft': aircraft, './lib/map-names': maps,
    './lib/combat-activity': combat, './lib/activity-search': activitySearch, './game-icon': gameIcons, './lib/vector-bridge': { vectorEndpoint: () => null } };
  const source = readFileSync(new URL(`../app/${file}.tsx`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source + extra, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const exports = {};
  const require = createRequire(import.meta.url);
  runInNewContext(outputText, { exports, require: id => imported[id] ?? (id.startsWith('./') ? ui(id.slice(2)) : require(id)) });
  return exports;
}

const playedAt = new Date().toISOString();
const result = { schemaVersion: 1, id: 'abcdefab', accountId: '42', player: 'Pilot', playedAt,
  mission: null, outcome: 'unknown', conflict: false, hasLog: true, hasReplay: true, rewardsFinal: false,
  wp: 0, exp: 0, kills: 1, groundKills: 0, navalKills: 0, aiKills: 0, aiGroundKills: 0, aiNavalKills: 0,
  assists: 0, deaths: 1, spawns: 1, score: 0, seconds: null, vehicles: ['g_55s'] };
const archive = { connection: 'connected', status: 'ready', paused: false, startedAt: new Date(Date.parse(playedAt) - 60000).toISOString(), unreadable: 0, rejected: 0, battles: [result] };
const props = { archive, account: '42', accounts: [['42', 'Pilot']], onAccountChange: () => {}, onHistory: () => {}, telemetryOnline: true };

test('Results and session copy preserve unavailable, not-final, conflict and aircraft identities', () => {
  const original = structuredClone(archive);
  for (const file of ['session-overview', 'file-battles-panel']) {
    const component = ui(file).default;
    const html = renderToStaticMarkup(createElement(component, props));
    assert.match(html, /No result/); assert.match(html, /not final/i); assert.match(html, /N\/A/);
    assert.match(html, /G\.55S/); assert.match(html, /Kingdom of Italy/);
    assert.match(html, /1 kill/); assert.match(html, /1 death/);
    assert.doesNotMatch(html, /[\u2012-\u2015]|Collector|Provisional|UNRESOLVED/);
    const conflict = { ...archive, battles: [{ ...result, conflict: true }] };
    assert.match(renderToStaticMarkup(createElement(component, { ...props, archive: conflict })), /Results disagree/);
  }
  assert.deepEqual(archive, original);
  assert.equal(battles.summarizeFileBattles(archive.battles).wp, null);
});

test('session and battle details share localized map names without changing saved results', () => {
  const mapped = { ...archive, battles: [{ ...result, mission: 'avg_egypt_sinai' }] };
  const original = structuredClone(mapped);
  for (const file of ['session-overview', 'file-battles-panel']) {
    const component = ui(file).default;
    const html = renderToStaticMarkup(createElement(component, { ...props, archive: mapped }));
    assert.match(html, /Sinai/);
    assert.doesNotMatch(html, /avg_egypt_sinai|avg egypt sinai/);
    assert.match(html, /G\.55S/);
    const noAircraft = { ...mapped, battles: [{ ...mapped.battles[0], vehicles: [] }] };
    assert.match(renderToStaticMarkup(createElement(component, { ...props, archive: noAircraft })), /<strong>Sinai<\/strong>/);
  }
  assert.deepEqual(mapped, original);
});

test('Activity keeps zero event counts and explicit AI target labels', () => {
  const Panel = componentLoader()('combat-activity-panel.tsx').default;
  const zero = renderToStaticMarkup(createElement(Panel, { activity: combat.emptyCombatActivity() }));
  assert.match(zero, /0 events/); assert.doesNotMatch(zero, /[\u2012-\u2015]/);
  const tracker = new combat.CombatActivityTracker();
  const map = { valid: true, map_generation: 1 };
  tracker.ingest({ before: map, after: map, hud: { damage: [] } }, 100000);
  const activity = tracker.ingest({ before: map, after: map, hud: { damage: [{ id: 1, time: 1, msg: 'Pilot (Yak) destroyed [ai] Bomber' }] } }, 101000);
  const withAi = renderToStaticMarkup(createElement(Panel, { activity }));
  assert.match(withAi, /1 event/); assert.match(withAi, /AI target/);
  assert.equal(activity.rows[0].destroyed, 1); assert.equal(activity.rows[0].aiDestroyed, 1);
});

test('offline and paused copy distinguishes results updates from the game connection', () => {
  const component = ui('session-overview').default;
  const offline = renderToStaticMarkup(createElement(component, { ...props, telemetryOnline: false, archive: { ...archive, connection: 'offline' } }));
  assert.match(offline, /Results offline/); assert.match(offline, /Game disconnected/);
  const paused = renderToStaticMarkup(createElement(component, { ...props, archive: { ...archive, paused: true } }));
  assert.match(paused, /Updates paused/); assert.match(paused, /Between battles/);
});
