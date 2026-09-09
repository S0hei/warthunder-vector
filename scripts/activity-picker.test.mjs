import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { CombatActivityTracker } from '../app/lib/combat-activity.ts';
import { componentLoader } from './component-test-loader.mjs';

const load = componentLoader();
const search = load('lib/activity-search.ts');
const Picker = load('activity-player-picker.tsx').default;
const sample = (damage, generation = 1) => ({ before: { valid: generation !== null, map_generation: generation }, after: { valid: generation !== null, map_generation: generation }, hud: { damage } });
const message = (id, msg, time = id * 10) => ({ id, msg, time });
const fixture = () => { const tracker = new CombatActivityTracker(); tracker.ingest(sample([]), 100000); return tracker; };
const annotate = (tracker, record, targetInRoster = true, observedAt = 101000, targetTeam = 'enemy') => tracker.annotate({ schemaVersion: 1, sessionId: '123456789abcdef', events: [{
  message: record.msg, observedAt: new Date(observedAt).toISOString(), actorTeam: 'self', targetTeam, targetInRoster,
}] });

test('one picker entry per exact name follows the newest observed aircraft, not arrival order', () => {
  const tracker = fixture();
  const first = message(1, 'Pilot (g_55s) destroyed ПВО');
  tracker.ingest(sample([first]), 101000);
  const original = tracker.snapshot();
  const newer = message(3, 'Pilot (yak-3u) destroyed ПВО');
  const late = message(2, 'Pilot (Old plane) destroyed ПВО');
  const result = tracker.ingest(sample([first, newer, late]), 102000);
  assert.equal(result.participants.length, 1);
  assert.equal(result.participants[0].vehicle, 'yak-3u');
  assert.equal(result.participants[0].time, 30);
  assert.equal(original.participants[0].vehicle, 'g_55s');
  assert.equal(result.rows.length, 3); // The event totals still keep separate vehicles.
  assert.equal(result.eventCount, 3);
});

test('target-only sightings need roster identity, never team color or aircraft parentheses alone', () => {
  const tracker = fixture(), record = message(1, 'Pilot (Yak) critically damaged Target (Су-6 (АМ-42))');
  tracker.ingest(sample([record]), 101000);
  assert.equal(tracker.snapshot().participants.length, 1);
  assert.equal(annotate(tracker, record, false).participants.length, 1);
  assert.equal(annotate(tracker, record, 'true').participants.length, 1);
  const accepted = annotate(tracker, record);
  const target = accepted.participants.find(p => p.name === 'Target');
  assert.equal(target.vehicle, 'Су-6 (АМ-42)');
  assert.equal(target.team, 'enemy');
  assert.equal(accepted.rows.length, 1);
  assert.equal(accepted.eventCount, 1);
  const anonymous = message(2, 'Pilot (Yak) destroyed Су-6 (АМ-42)');
  tracker.ingest(sample([record, anonymous]), 102000);
  annotate(tracker, anonymous, false, 102000);
  assert.ok(!tracker.snapshot().participants.some(p => p.name === 'Су-6'));
});

test('later target sightings update an already observed participant without inventing new names', () => {
  const tracker = fixture();
  const result = tracker.ingest(sample([
    message(1, 'Pilot (Yak) destroyed ПВО'),
    message(2, 'Other (Spitfire) shot down Pilot (G.55S)'),
    message(3, '[ai] Bot (Bomber) destroyed ПВО'),
  ]), 101000);
  assert.equal(result.participants.find(p => p.name === 'Pilot').vehicle, 'G.55S');
  assert.equal(result.participants.length, 2);
});

test('old, ambiguous, and unrelated annotations cannot populate a new flight', () => {
  const tracker = fixture(), record = message(1, 'Pilot (Yak) shot down Target (Bf 109)');
  tracker.ingest(sample([record]), 101000);
  annotate(tracker, record, true, 50000);
  assert.equal(tracker.snapshot().participants.length, 1);
  tracker.ingest(sample([], 2), 200000);
  annotate(tracker, record);
  assert.equal(tracker.snapshot().participants.length, 0);
});

test('participant sightings survive event pruning but clear for new flights and reconnects', () => {
  const tracker = fixture();
  const records = Array.from({ length: 70 }, (_, i) => message(i + 1, `Pilot${i} (Yak) destroyed ПВО`));
  const result = tracker.ingest(sample(records), 101000);
  assert.equal(result.recent.length, 60);
  assert.equal(result.participants.length, 70);
  assert.equal(tracker.ingest(sample(records, null), 102000).participants.length, 70);
  assert.equal(tracker.snapshot().status, 'paused');
  assert.equal(tracker.ingest(sample(records, 2), 103000).participants.length, 0);
  tracker.ingest(sample([message(71, 'New (Yak) crashed')], 2), 104000);
  assert.equal(tracker.disconnected().participants.length, 1);
  assert.equal(tracker.ingest(sample([], 2), 105000).participants.length, 0);
});

test('picker search understands readable aircraft names and selected names filter both event parties exactly', () => {
  const tracker = fixture();
  const a = tracker.ingest(sample([
    message(1, 'Pilot (g_55s) destroyed ПВО'),
    message(2, 'PilotTwo (Yak) shot down Pilot (g_55s)'),
    message(3, '=TAG= Pilot (Spitfire) crashed'),
  ]), 101000);
  assert.equal(search.matchingParticipants(a.participants, 'g.55s')[0].name, 'Pilot');
  assert.equal(search.matchingParticipants(a.participants, 'PILOTTWO').length, 1);
  assert.equal(a.rows.filter(row => search.activityRowMatches(row, 'Pilot', 'Pilot')).length, 1);
  assert.equal(a.recent.filter(event => search.activityEventMatches(event, 'Pilot', 'Pilot')).length, 2);
  assert.equal(a.recent.filter(event => search.activityEventMatches(event, 'G.55S', null)).length, 2);
});

test('selected aircraft card is color-coded, localized and explicitly last observed', () => {
  const tracker = fixture(), record = message(1, 'Pilot (g_55s) destroyed ПВО');
  tracker.ingest(sample([record]), 101000);
  const a = annotate(tracker, record);
  const props = { participants: a.participants, status: 'live', search: 'Pilot', selectedName: 'Pilot', onChange() {} };
  const html = renderToStaticMarkup(React.createElement(Picker, props));
  assert.match(html, /role="combobox"/);
  assert.match(html, /Last observed aircraft/);
  assert.match(html, /combat-self/);
  assert.match(html, /G\.55S/);
  assert.match(html, /Kingdom of Italy/);
  assert.match(html, /Clear participant filter/);
  assert.doesNotMatch(html, /[\u2012-\u2015]|Current aircraft|PilotTwo/);
  assert.match(renderToStaticMarkup(React.createElement(Picker, { ...props, status: 'paused' })), /Last flight/);
});

// Exercise the component's actual event handlers using an in-memory React hook
// harness. This is not browser testing and makes no DOM or game interactions.
function pickerHarness(initial) {
  const state = []; let cursor = 0, props = initial;
  const hookedReact = { ...React,
    useState(value) { const i = cursor++; if (!(i in state)) state[i] = typeof value === 'function' ? value() : value; return [state[i], v => { state[i] = typeof v === 'function' ? v(state[i]) : v; }]; },
    useRef: () => ({ current: null }), useEffect() {}, useMemo: fn => fn(), useId: () => 'picker-test',
    useContext: () => ({ language: 'en' }), useCallback: fn => fn,
  };
  const Component = componentLoader({ react: hookedReact })('activity-player-picker.tsx').default;
  function render() { cursor = 0; return Component({ ...props, onChange: (search, selectedName) => { props = { ...props, search, selectedName }; } }); }
  return { render, props: () => props };
}
function nodes(element, predicate) {
  if (element == null || typeof element !== 'object') return [];
  if (Array.isArray(element)) return element.flatMap(e => nodes(e, predicate));
  return [...(predicate(element) ? [element] : []), ...nodes(element.props?.children, predicate)];
}

test('picker keyboard navigation, selection, clearing, Escape and aircraft updates work together', () => {
  const participants = ['Alpha', 'Bravo'].map((name, i) => ({ name, vehicle: 'g_55s', team: i ? 'enemy' : 'ally', observedAt: 101000 }));
  const h = pickerHarness({ participants, status: 'live', search: '', selectedName: null });
  const input = () => nodes(h.render(), e => e.type === 'input')[0];
  const key = key => input().props.onKeyDown({ key, preventDefault() {} });
  key('ArrowDown');
  assert.equal(input().props['aria-expanded'], true);
  key('ArrowDown'); key('Enter');
  assert.equal(h.props().selectedName, 'Bravo');
  assert.equal(input().props['aria-expanded'], false);
  participants[1] = { ...participants[1], vehicle: 'yak-3u' };
  assert.ok(nodes(h.render(), e => e.props?.vehicles?.[0] === 'yak-3u').length);
  key('ArrowUp'); key('Escape');
  assert.equal(input().props['aria-expanded'], false);
  nodes(h.render(), e => e.props?.['aria-label'] === 'Clear participant filter')[0].props.onClick();
  assert.equal(h.props().search, ''); assert.equal(h.props().selectedName, null);
  input().props.onChange({ target: { value: 'nobody' } });
  assert.equal(nodes(h.render(), e => e.props?.role === 'option').length, 0);
  key('ArrowDown'); key('Enter'); // An empty match list never selects undefined.
  assert.equal(h.props().selectedName, null);
});

test('each flight remounts the picker and picker dimensions follow the existing 4K scale', () => {
  const panel = readFileSync(new URL('../app/combat-activity-panel.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(panel, /ActivityFlightPanel key=\{activity\.startedAt/);
  assert.match(css, /\.activity-picker-menu ul[^}]*max-height: min\(18rem, 35vh\)[^}]*overflow-y: auto/);
  assert.match(css, /\.activity-picked \.aircraft-list[^}]*font-size: 1\.125rem/);
});

test('pointer selection and blur close the menu without losing the selected identity', () => {
  const participant = { name: 'Pilot', vehicle: 'Yak', team: 'unknown', observedAt: 101000 };
  const h = pickerHarness({ participants: [participant], status: 'live', search: '', selectedName: null });
  nodes(h.render(), e => e.props?.['aria-label'] === 'Browse participants')[0].props.onClick();
  const option = nodes(h.render(), e => e.props?.role === 'option')[0];
  let prevented = false;
  option.props.onMouseDown({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  option.props.onClick();
  assert.equal(h.props().selectedName, 'Pilot');
  assert.equal(nodes(h.render(), e => e.type === 'input')[0].props['aria-expanded'], false);
  nodes(h.render(), e => e.props?.['aria-label'] === 'Browse participants')[0].props.onClick();
  h.render().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(nodes(h.render(), e => e.type === 'input')[0].props['aria-expanded'], false);
});

test('participant names and vehicle labels remain inert React text', () => {
  const name = '<script>not executable</script>';
  const html = renderToStaticMarkup(React.createElement(Picker, { participants: [{ name, vehicle: '<img onerror=bad>', team: 'unknown', observedAt: 101000 }],
    status: 'live', search: name, selectedName: name, onChange() {} }));
  assert.doesNotMatch(html, /<script>|<img onerror/i);
  assert.match(html, /&lt;script&gt;/);
});

test('flight participant retention is bounded', () => {
  const tracker = fixture();
  const result = tracker.ingest(sample(Array.from({ length: 300 }, (_, i) => message(i + 1, `Pilot${i} (Yak) crashed`))), 101000);
  assert.equal(result.participants.length, 256);
  assert.equal(result.eventCount, 300);
});

test('a pre-update Activity snapshot stays renderable until the new tracker supplies its directory', () => {
  const html = renderToStaticMarkup(React.createElement(Picker, { status: 'live', search: '', selectedName: null, onChange() {} }));
  assert.match(html, /Find participant/);
  assert.doesNotMatch(html, /Last observed aircraft/);
});
