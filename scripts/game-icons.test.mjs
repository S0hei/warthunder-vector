import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import catalog from '../app/lib/game-icons.json' with { type: 'json' };
import { iconAsset, iconFiles } from './game-icons.mjs';
import { componentLoader } from './component-test-loader.mjs';
import { CombatActivityTracker } from '../app/lib/combat-activity.ts';

const load = componentLoader();
const { GameIcon, GameLabel } = load('game-icon.tsx');

test('the complete icon set uses pinned game assets and self-contained image data', () => {
  assert.match(catalog.source.revision, /^[a-f0-9]{40}$/);
  assert.equal(catalog.source.directory, 'atlases.vromfs.bin_u/gameuiskin');
  assert.deepEqual(Object.keys(catalog.icons).sort(), Object.keys(iconFiles).sort());
  for (const [name, entry] of Object.entries(catalog.icons)) {
    assert.equal(entry.file, iconFiles[name]);
    assert.match(entry.sha256, /^[a-f0-9]{64}$/);
    assert.match(entry.src, /^data:image\/(?:png|svg\+xml);base64,/);
    const data = Buffer.from(entry.src.split(',')[1], 'base64');
    assert.deepEqual(iconAsset(entry.file, data), { mode: entry.mode, src: entry.src });
    if (entry.mode === 'image') assert.equal(createHash('sha256').update(data).digest('hex'), entry.sha256);
    else {
      assert.match(data.toString('utf8'), /<svg\b[^>]*viewBox=/);
      assert.doesNotMatch(data.toString('utf8'), /<metadata|<script|\bon\w+\s*=|@import/i);
    }
  }
  assert.equal(catalog.icons.silverLions.file, 'wp_coin.png');
  assert.equal(catalog.icons.experience.file, 'lb_online_exp_gained_for_common.svg');
});

test('icon maintenance rejects active SVGs, external references, invalid images and excessive size', () => {
  for (const text of ['<svg onload="bad()"/>', '<svg><script>bad()</script></svg>', '<svg><image href="https://example.com/x"/></svg>',
    '<svg><style>@import "evil.css";</style></svg>', '<svg><use href="#other"/></svg>', '<svg><animate attributeName="x"/></svg>',
    '<!DOCTYPE svg><svg/>', '<svg><style>path{fill:url(https://example.com/x)}</style></svg>']) {
    assert.throws(() => iconAsset('icon.svg', Buffer.from(text)));
  }
  assert.throws(() => iconAsset('icon.png', Buffer.from('not a PNG')));
  assert.throws(() => iconAsset('icon.svg', Buffer.alloc(65537)));
  assert.throws(() => iconAsset('icon.html', Buffer.from('<html/>')));
  const png = Buffer.from(catalog.icons.silverLions.src.split(',')[1], 'base64');
  png.writeUInt32BE(4096, 16);
  assert.throws(() => iconAsset('icon.png', png));
});

test('icons are decorative, labels remain readable, and inline SVG IDs cannot leak into the page', () => {
  for (const name of Object.keys(catalog.icons)) {
    const html = renderToStaticMarkup(createElement(GameLabel, { icon: name }, 'Readable label'));
    assert.match(html, new RegExp(`data-game-icon="${name}"`));
    assert.match(html, /aria-hidden="true"/);
    assert.match(html, />Readable label</);
    assert.doesNotMatch(html, /<svg|<script|src="https?:|tabindex=/i);
  }
  assert.match(renderToStaticMarkup(createElement(GameIcon, { name: 'silverLions' })), /background-image:/);
  assert.match(renderToStaticMarkup(createElement(GameIcon, { name: 'experience' })), /mask-image:/);
});

test('Silver Lions and experience icons preserve reward labels, disclaimers and unknown values', () => {
  const RewardLabel = load('reward-label.tsx').default;
  const earnings = renderToStaticMarkup(createElement(RewardLabel, { kind: 'wp' }));
  const xp = renderToStaticMarkup(createElement(RewardLabel, { kind: 'exp' }));
  assert.match(earnings, /data-game-icon="silverLions"/); assert.match(earnings, />Battle earnings</);
  assert.match(earnings, /may differ from your net Silver Lions after costs/);
  assert.match(xp, /data-game-icon="experience"/); assert.match(xp, />Experience</);
  assert.match(xp, /may differ from vehicle research points/);
  const archive = { connection: 'connected', status: 'ready', paused: false, unreadable: 0, rejected: 0, startedAt: null, battles: [] };
  for (const file of ['session-overview.tsx', 'file-battles-panel.tsx']) {
    const html = renderToStaticMarkup(createElement(load(file).default, { archive, account: undefined, accounts: [], onAccountChange() {}, onHistory() {}, telemetryOnline: false }));
    for (const name of ['silverLions', 'experience', 'victories', 'killDeath', 'killSpawn']) assert.match(html, new RegExp(`data-game-icon="${name}"`));
    assert.match(html, /N\/A/);
    assert.doesNotMatch(html, /NaN/);
  }
});

test('Activity uses game action icons while keeping event wording and participant colors', () => {
  const tracker = new CombatActivityTracker();
  const map = { valid: true, map_generation: 1 };
  tracker.ingest({ before: map, after: map, hud: { damage: [] } }, 100000);
  const messages = ['Pilot (Yak) shot down Foe (Bf 109)', 'Pilot (Yak) critically damaged Foe (Bf 109)', 'Pilot (Yak) crashed'];
  const activity = tracker.ingest({ before: map, after: map, hud: { damage: messages.map((msg, i) => ({ msg, id: i + 1, time: i + 1 })) } }, 101000);
  const html = renderToStaticMarkup(createElement(load('combat-activity-panel.tsx').default, { activity }));
  for (const name of ['airKills', 'target', 'deaths', 'activity', 'participants']) assert.match(html, new RegExp(`data-game-icon="${name}"`));
  assert.match(html, /Shot down/); assert.match(html, /Critical damage/); assert.match(html, /Crashed/);
  assert.match(html, /combat-unknown/); assert.equal(activity.eventCount, 3);
});

test('icons scale with text and navigation badges cannot style icon spans as counters', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.game-icon \{[^}]*width: 1\.35em; height: 1\.35em/);
  assert.match(css, /\.game-icon-mask[^}]*mask-size: contain/);
  assert.match(css, /\.intel-tabs \.intel-tab-count/);
  assert.doesNotMatch(css, /\.intel-tabs button span/);
  assert.doesNotMatch(css.match(/\.game-icon \{[^}]*\}/)?.[0] ?? '', /(?:border|background):/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /GameIcon name=\{tab === 'contacts' \? 'target' : tab\}/);
});
