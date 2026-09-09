import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolveBattlePeriod, battlesForPeriod, summarizeFileBattles } from '../app/lib/file-battles.ts';
import { componentLoader } from './component-test-loader.mjs';

const range = (kind, today = '2026-09-09', from = '', to = '') => resolveBattlePeriod(kind, today, { from, to });
const local = (day, time = '12:00:00') => new Date(`${day}T${time}`).toISOString();
const battle = (id, day, overrides = {}) => ({ schemaVersion: 1, id, accountId: '42', player: 'Pilot', playedAt: local(day),
  mission: 'avg_egypt_sinai', outcome: 'win', conflict: false, hasLog: true, hasReplay: true, rewardsFinal: true,
  wp: 1000, exp: 200, kills: 3, groundKills: 1, navalKills: 0, aiKills: 2, aiGroundKills: 4, aiNavalKills: 0,
  assists: 1, deaths: 1, spawns: 2, score: 900, seconds: 120, vehicles: ['g_55s'], ...overrides });

test('day presets follow calendar dates across months, years and leap days', () => {
  for (const [kind, day, expected] of [
    ['today', '2026-09-09', '2026-09-09'], ['yesterday', '2026-09-09', '2026-09-08'],
    ['day-before-yesterday', '2026-09-09', '2026-09-07'], ['yesterday', '2026-01-01', '2025-12-31'],
    ['day-before-yesterday', '2026-03-01', '2026-02-27'], ['yesterday', '2024-03-01', '2024-02-29'],
  ]) assert.deepEqual(range(kind, day), { kind, from: expected, to: expected, error: null });
});

test('this week is Monday through today, including Sunday and year boundaries', () => {
  for (const [day, monday] of [['2026-09-07', '2026-09-07'], ['2026-09-09', '2026-09-07'],
    ['2026-09-13', '2026-09-07'], ['2026-09-14', '2026-09-14'], ['2026-01-01', '2025-12-29']]) {
    assert.deepEqual(range('week', day), { kind: 'week', from: monday, to: day, error: null });
  }
});

test('custom dates include both full local days, not their UTC dates or import time', () => {
  const first = battle('first', '2026-09-07', { playedAt: local('2026-09-07', '00:00:00.000') });
  const last = battle('last', '2026-09-08', { playedAt: local('2026-09-08', '23:59:59.999') });
  const before = battle('before', '2026-09-06', { playedAt: local('2026-09-06', '23:59:59.999') });
  const after = battle('after', '2026-09-09', { playedAt: local('2026-09-09', '00:00:00.000') });
  const input = [after, last, first, before], original = structuredClone(input);
  assert.deepEqual(battlesForPeriod(input, '42', range('custom', '2026-09-09', '2026-09-07', '2026-09-08'), null), [last, first]);
  assert.deepEqual(input, original);
  assert.equal(battlesForPeriod(input, '42', range('custom', '2026-09-09', '2026-09-07', '2026-09-07'), null).length, 1);
});

test('invalid, incomplete, reversed and future ranges never silently show all battles', () => {
  const input = [battle('a', '2026-09-08')];
  for (const [from, to] of [['', ''], ['', '2026-09-08'], ['2026-09-08', ''], ['2026-09-09', '2026-09-08'],
    ['2026-09-31', '2026-09-31'], ['2026-02-29', '2026-03-01'], ['garbage', '2026-09-08'],
    ['2026-9-1', '2026-09-08'], ['2026-09-08', '2026-09-10'], ['0000-01-01', '2026-09-08']]) {
    const period = range('custom', '2026-09-09', from, to);
    assert.ok(period.error, `${from} to ${to}`);
    assert.deepEqual(battlesForPeriod(input, '42', period, null), []);
  }
  assert.ok(range('today', 'not-a-date').error);
});

test('account isolation and existing session/all scopes are preserved', () => {
  const old = battle('old', '2026-09-07'), recent = battle('recent', '2026-09-09'), other = battle('other', '2026-09-09', { accountId: '43' });
  const input = [other, recent, old], startedAt = local('2026-09-09', '11:00:00');
  assert.deepEqual(battlesForPeriod(input, '42', range('all'), startedAt), [recent, old]);
  assert.deepEqual(battlesForPeriod(input, '42', range('session'), startedAt), [recent]);
  assert.deepEqual(battlesForPeriod(input, '43', range('today'), startedAt), [other]);
  for (const since of [null, 'invalid', local('2026-09-09', '12:00:00.001')]) assert.deepEqual(battlesForPeriod(input, '42', range('session'), since), []);
  assert.deepEqual(battlesForPeriod(input, undefined, range('all'), startedAt), []);
});

test('filtered summaries preserve unknown results, provisional rewards and independent kill ratios', () => {
  const resolved = battle('a', '2026-09-08'), pending = battle('b', '2026-09-08', { outcome: 'unknown', rewardsFinal: false, wp: 99999, exp: 99999 });
  const older = battle('c', '2026-09-07', { wp: 88888 });
  const totals = summarizeFileBattles(battlesForPeriod([resolved, pending, older], '42', range('yesterday'), null));
  assert.equal(totals.count, 2); assert.equal(totals.wins, 1); assert.equal(totals.unresolved, 1); assert.equal(totals.winRate, 100);
  assert.equal(totals.kd, 4); assert.equal(totals.ks, 2); assert.equal(totals.wp, 1000); assert.equal(totals.exp, 200);
});

test('local-day filtering works east/west of UTC and on daylight-saving transitions', () => {
  const moduleUrl = new URL('../app/lib/file-battles.ts', import.meta.url).href;
  for (const timezone of ['Europe/Moscow', 'America/New_York', 'Pacific/Auckland']) {
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { resolveBattlePeriod, battlesForPeriod, localBattleDay } from ${JSON.stringify(moduleUrl)};
      for (const [today, yesterday] of [['2026-03-09', '2026-03-08'], ['2026-11-02', '2026-11-01'], ['2026-09-28', '2026-09-27']]) {
        const p = resolveBattlePeriod('yesterday', today, { from: '', to: '' });
        assert.equal(p.from, yesterday); assert.equal(p.to, yesterday);
        const start = new Date(yesterday + 'T00:00:00'), end = new Date(yesterday + 'T23:59:59.999');
        const rows = [new Date(start.getTime() - 1), start, end, new Date(end.getTime() + 1)]
          .map((d, i) => ({ id: i, accountId: '42', playedAt: d.toISOString() }));
        assert.deepEqual(battlesForPeriod(rows, '42', p, null).map(b => b.id), [1, 2]);
        assert.equal(localBattleDay(start.toISOString()), yesterday);
      }
    `], { env: { ...process.env, TZ: timezone }, stdio: 'pipe' });
  }
});

// Real component event handlers, exercised in memory without a browser or DOM.
function harness(battles) {
  const state = []; let cursor = 0, clockIndex = -1;
  let props = { archive: { connection: 'connected', status: 'ready', paused: false, startedAt: local('2026-09-09', '10:00:00'), unreadable: 0, rejected: 0, battles },
    account: '42', accounts: [['42', 'Pilot'], ['43', 'Other']] };
  const hookedReact = { ...React,
    useState(value) {
      const i = cursor++;
      if (!(i in state)) {
        state[i] = typeof value === 'function' ? value() : value;
        if (typeof state[i] === 'string' && /^\d{4}-.*Z$/.test(state[i])) { clockIndex = i; state[i] = local('2026-09-09'); }
      }
      return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
    }, useEffect() {}, useMemo: fn => fn(), useContext: () => ({ language: 'en' }), useCallback: fn => fn,
  };
  const Panel = componentLoader({ react: hookedReact })('file-battles-panel.tsx').default;
  function render() { cursor = 0; return Panel({ ...props, onAccountChange: account => { props = { ...props, account }; } }); }
  const find = (predicate) => nodes(render(), predicate);
  const input = label => find(e => e.props?.['aria-label'] === label)[0];
  return { render, find, input, change: (label, value) => input(label).props.onChange({ target: { value } }),
    rows: () => find(e => e.props?.battle).map(e => e.props.battle), tick: day => { state[clockIndex] = local(day); },
    update: battles => { props = { ...props, archive: { ...props.archive, battles } }; } };
}
function nodes(element, predicate) {
  if (element == null || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(e => nodes(e, predicate));
  return [...(predicate(element) ? [element] : []), ...nodes(element.props?.children, predicate)];
}

test('Results renders all requested presets and its rows, totals and date fields follow selection', () => {
  const h = harness([battle('a', '2026-09-09'), battle('b', '2026-09-08', { outcome: 'loss' }), battle('c', '2026-09-07'), battle('d', '2026-09-06')]);
  assert.deepEqual(h.find(e => e.type === 'option').slice(0, 7).map(e => e.props.value), ['today', 'yesterday', 'day-before-yesterday', 'week', 'custom', 'session', 'all']);
  assert.equal(h.rows()[0].id, 'a'); assert.equal(h.find(e => e.type === 'input').length, 0);
  h.change('Battle period', 'yesterday'); assert.equal(h.rows()[0].id, 'b');
  assert.match(renderToStaticMarkup(h.render()), /0%/);
  h.change('Battle period', 'day-before-yesterday'); assert.equal(h.rows()[0].id, 'c');
  h.change('Battle period', 'week'); assert.equal(h.rows().length, 3);
  h.change('Battle period', 'custom');
  assert.equal(h.input('Start date').props.value, '2026-09-07'); assert.equal(h.input('End date').props.value, '2026-09-09');
  h.change('Start date', '2026-09-08'); h.change('End date', '2026-09-08');
  assert.equal(h.rows()[0].id, 'b'); assert.equal(h.rows().length, 1);
  assert.match(renderToStaticMarkup(h.render()), /1 battle/);
  h.change('Battle period', 'today'); h.change('Battle period', 'custom');
  assert.equal(h.input('End date').props.value, '2026-09-08');
});

test('custom validation is accessible and does not show stale rows or totals', () => {
  const h = harness([battle('a', '2026-09-09')]);
  h.change('Battle period', 'custom'); h.change('Start date', '');
  assert.equal(h.input('Start date').props['aria-invalid'], true);
  assert.equal(h.input('Start date').props['aria-describedby'], 'results-date-error');
  assert.equal(h.rows().length, 0);
  let html = renderToStaticMarkup(h.render());
  assert.match(html, /role="alert"/); assert.match(html, /Choose a start and end date/); assert.match(html, /0 battles/);
  h.change('Start date', '2026-09-09'); h.change('End date', '2026-09-08');
  assert.match(renderToStaticMarkup(h.render()), /End date must be on or after start date/);
  h.change('End date', '2026-09-09');
  assert.equal(h.input('Start date').props['aria-invalid'], false); assert.equal(h.rows().length, 1);
});

test('pagination resets with range, custom dates, account and midnight, but survives archive refresh', () => {
  const many = day => Array.from({ length: 25 }, (_, i) => battle(`${day}-${i}`, day));
  const h = harness([...many('2026-09-10'), ...many('2026-09-09'), ...many('2026-09-08')]);
  const older = () => h.find(e => e.type === 'button' && e.props.children === 'Older')[0];
  const pageOne = () => assert.equal(h.rows().length, 20);
  pageOne(); older().props.onClick(); assert.equal(h.rows().length, 5);
  h.update([...many('2026-09-10'), ...many('2026-09-09'), ...many('2026-09-08')]); assert.equal(h.rows().length, 5);
  h.change('Battle period', 'yesterday'); pageOne(); older().props.onClick();
  h.change('Battle period', 'custom'); pageOne(); older().props.onClick();
  h.change('Start date', '2026-09-07'); pageOne();
  h.change('Battle period', 'today'); older().props.onClick();
  h.tick('2026-09-10'); pageOne(); assert.ok(h.rows().every(b => b.id.startsWith('2026-09-10')));
  h.change('Game account', '43'); assert.equal(h.rows().length, 0);
  h.change('Game account', '42'); pageOne();
});

test('period controls keep native keyboard semantics and readable responsive sizing', () => {
  const h = harness([]); h.change('Battle period', 'custom');
  for (const label of ['Start date', 'End date']) {
    assert.equal(h.input(label).props.type, 'date'); assert.equal(h.input(label).props.required, true);
    assert.equal(h.input(label).props.max, '2026-09-09');
  }
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.results-date-range\s*\{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.results-date-range input\s*\{[^}]*min-height: 2\.5rem[^}]*\.875rem/);
  assert.match(css, /\.results-date-range input:focus-visible/);
  const source = readFileSync(new URL('../app/file-battles-panel.tsx', import.meta.url), 'utf8');
  assert.match(source, /setInterval\(\(\) => setNow\(new Date\(\)\.toISOString\(\)\), 30000\)/);
});
