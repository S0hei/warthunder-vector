import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
// Evaluate the actual stylesheet's fluid root rule at representative CSS viewports.
// These are unit checks of the sizing contract, not browser/layout screenshots.
function rootSize(width, height, browserFont = 16) {
  const rule = /html \{ font-size: clamp\(([\d.]+)%, calc\(([\d.]+)% \+ min\(([\d.]+)vw, ([\d.]+)vh\)\), ([\d.]+)%\); \}/.exec(css);
  assert.ok(rule, 'Expected one relative, two-axis responsive root rule');
  const [, floor, relative, vw, vh, ceiling] = rule.map(Number);
  return Math.min(browserFont * ceiling / 100, Math.max(browserFont * floor / 100,
    browserFont * relative / 100 + Math.min(width * vw / 100, height * vh / 100)));
}

test('Full HD retains a readable 16px root baseline', () => {
  assert.ok(Math.abs(rootSize(1920, 1080) - 16) < .001);
  assert.equal(rootSize(1920, 970), 16); // Browser chrome does not shrink text.
});
test('QHD and 4K increase typography and rem-based geometry together', () => {
  assert.ok(Math.abs(rootSize(2560, 1440) - 18.6667) < .001);
  assert.ok(Math.abs(rootSize(3840, 2160) - 24) < .001);
  assert.ok(rootSize(3840, 2040) > 23);
});
test('short ultrawides and half-width windows do not over-enlarge panels', () => {
  assert.ok(Math.abs(rootSize(5120, 1440) - rootSize(2560, 1440)) < .001);
  assert.ok(Math.abs(rootSize(1920, 2160) - 16) < .001);
  assert.equal(rootSize(3840, 700), 16);
});
test('small viewports never shrink the font floor; extreme resolutions are capped', () => {
  for (const [width, height] of [[375, 667], [780, 600], [1280, 720]]) assert.equal(rootSize(width, height), 16);
  assert.equal(rootSize(7680, 4320), 32);
});
test('OS-scaled 4K uses its CSS viewport rather than applying DPR again', () => {
  assert.ok(Math.abs(rootSize(2560, 1440) - 18.6667) < .001); // 150% OS scaling.
  assert.ok(Math.abs(rootSize(1920, 1080) - 16) < .001); // 200% OS scaling.
  assert.doesNotMatch(css, /devicePixelRatio|resolution\s*:/);
});
test('larger browser font preferences and zoom still enlarge text', () => {
  assert.ok(rootSize(3840, 2160, 32) > rootSize(3840, 2160, 16));
  // Page zoom halves the CSS viewport, but the physical glyphs remain larger.
  assert.ok(rootSize(1920, 1080) * 2 > rootSize(3840, 2160));
});
test('reading sizes, panel widths and controls use scalable units', () => {
  assert.match(css, /--type-meta: \.75rem/);
  assert.match(css, /--type-label: \.875rem/);
  assert.match(css, /--type-body: 1rem/);
  assert.doesNotMatch(css, /font(?:-size)?:[^;{}]*\dpx/);
  assert.match(css, /grid-template-columns: 4\.5rem minmax\(0, 1fr\) clamp\(27\.5rem, 24vw, 40rem\)/);
  assert.match(css, /\.filter-bar \{ flex-wrap: wrap/);
  assert.match(css, /\.intel-tabs \{ flex-wrap: wrap/);
});

test('the sidebar grows proportionally on 4K while preserving the map and respecting short windows', () => {
  const rule = /grid-template-columns: 4\.5rem minmax\(0, 1fr\) clamp\(([\d.]+)rem, ([\d.]+)vw, ([\d.]+)rem\)/.exec(css);
  assert.ok(rule);
  const [, min, fluid, max] = rule.map(Number);
  const panel = (w, h) => Math.min(max * rootSize(w, h), Math.max(min * rootSize(w, h), fluid * w / 100));
  for (const [w, h] of [[3810, 1939], [3817, 1957], [3840, 2160], [2560, 1440], [1920, 1080]]) {
    assert.ok(panel(w, h) / w >= .23 && panel(w, h) / w <= .25);
    assert.ok(w - panel(w, h) - 4.5 * rootSize(w, h) > w * .7);
  }
  assert.equal(panel(5120, 700), 640);
  assert.match(css, /\.map-dock\s*\{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /@container \(max-width: 70rem\)/);
  assert.match(css, /\.map-dock \.filter-bar\s*\{[^}]*grid-column: 1 \/ -1/);
  assert.match(css, /\.tactical-shell:not\(\.session-mode\) \.intel-panel\s*\{[^}]*position: static/);
});
test('short windows fit the actual viewport and tables remain scrollable', () => {
  const shell = /\.tactical-shell \{([^}]+)\}/.exec(css)[1];
  assert.match(shell, /height: 100dvh/);
  assert.match(shell, /min-height: 0/);
  for (const selector of ['activity-table-wrap', 'results-table-wrap', 'contact-table-wrap']) {
    assert.match(css, new RegExp(`\\.${selector} \\{[^}]*overflow: auto`));
  }
  assert.doesNotMatch(css, /(?:^|[;{])\s*zoom\s*:/m);
});
